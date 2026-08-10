-- A guard on the job that can empty the storefront, and a way to see it.
--
-- deactivate_stale_products marks anything not seen for three days as
-- unavailable. The rule is right. What made it dangerous is that
-- nothing bounded it: when the collection stalled for longer than three
-- days, every product in the catalog qualified at once and a single
-- statement took the whole shop down. The catalog looked empty, the
-- job reported success, and nothing anywhere said why.
--
-- The failure that matters is not "some products went stale". It is
-- "everything went stale at once", which is never a fact about the
-- retailers and always a fact about the collector. So that case now
-- raises instead of running — which leaves a row in
-- cron.job_run_details saying exactly what it refused to do.

/*
 * Drop the original no-argument version first.
 *
 * Adding the defaulted `force` parameter changes the signature, and
 * `create or replace` against a different signature creates an
 * overload rather than replacing anything. Both then exist, the cron
 * job's `select deactivate_stale_products();` resolves to the exact
 * zero-argument match — the unguarded one — and the guard sits beside
 * it, installed and never called. That is a worse failure than having
 * no guard, because it reads as protected.
 */
drop function if exists public.deactivate_stale_products();

create or replace function public.deactivate_stale_products(
  force boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_live   bigint;
  v_doomed bigint;
  v_share  numeric;
  v_limit  numeric := 0.40;
begin
  select count(*) into v_live
  from public.product_catalog
  where is_available;

  -- Nothing live is not a state this function should react to, and
  -- dividing by it would be worse.
  if v_live = 0 then
    return;
  end if;

  select count(*) into v_doomed
  from public.product_catalog
  where is_available
    and last_seen_at < now() - interval '3 days';

  if v_doomed = 0 then
    return;
  end if;

  v_share := v_doomed::numeric / v_live::numeric;

  /*
   * Forty per cent. Ordinary turnover on a sale catalogue is a few per
   * cent a day; the incident this exists to prevent was a hundred. The
   * gap between those two is wide enough that the exact threshold does
   * not need defending — anything in it means the collector, not the
   * shops.
   */
  if v_share > v_limit and not force then
    raise exception
      'refusing to deactivate % of % live products (share %, guard %). This is almost certainly a stalled collection rather than real turnover — check public.cron_diagnostics() and the newest last_seen_at before overriding with deactivate_stale_products(force => true).',
      v_doomed, v_live, round(v_share, 3), round(v_limit, 3);
  end if;

  update public.product_catalog
  set is_available = false
  where is_available
    and last_seen_at < now() - interval '3 days';
end;
$$;

-- What the job would do, without doing it. Answering "is the guard
-- about to trip" should never require tripping it.
create or replace function public.stale_products_preview()
returns table (
  live             bigint,
  would_deactivate bigint,
  share            numeric,
  guard            numeric,
  would_refuse     boolean,
  newest_last_seen timestamptz,
  oldest_last_seen timestamptz
)
language sql
security definer
set search_path = public, extensions
as $$
  with live as (
    select * from public.product_catalog where is_available
  ),
  doomed as (
    select * from live where last_seen_at < now() - interval '3 days'
  )
  select
    (select count(*) from live),
    (select count(*) from doomed),
    round(coalesce((select count(*) from doomed)::numeric
                   / nullif((select count(*) from live), 0), 0), 3),
    0.40::numeric,
    coalesce((select count(*) from doomed)::numeric
             / nullif((select count(*) from live), 0), 0) > 0.40,
    (select max(last_seen_at) from live),
    (select min(last_seen_at) from live);
$$;

-- Every overload, not just the first one found.
--
-- The previous version ended in `limit 1`, so when a guarded overload
-- was created alongside the unguarded original it returned whichever
-- Postgres listed first and reported the function as unguarded — right
-- about that definition, silent about the other. A reader that shows
-- one of two definitions is worse than no reader.
create or replace function public.function_source(fn text)
returns text
language sql
security definer
set search_path = public, extensions
as $$
  select string_agg(pg_get_functiondef(p.oid), E'\n\n-- ---- next overload ----\n\n'
                    order by p.oid)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = fn;
$$;

-- Widened to every job, not just the refresh.
--
-- The previous version filtered to refresh-catalog-hourly, which meant
-- the one job that can empty the catalog was the one job whose history
-- could not be read — and the first time it ran unexpectedly, that
-- filter was what made it unexplainable.
create or replace function public.cron_diagnostics()
returns table (
  source text,
  at     timestamptz,
  detail text
)
language sql
security definer
set search_path = public, extensions
as $$
  select * from (
    select
      'cron'::text as source,
      d.start_time as at,
      (j.jobname || ': ' || d.status || ' ' || coalesce(d.return_message, ''))::text as detail
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid

    union all

    select
      'http'::text,
      r.created,
      ('status=' || coalesce(r.status_code::text, 'none') ||
       case when r.timed_out then ' TIMED_OUT' else '' end ||
       case when r.error_msg is not null then ' error=' || r.error_msg else '' end ||
       ' ' || coalesce(left(r.content, 200), ''))::text
    from net._http_response r
  ) rows
  order by at desc
  limit 40;
$$;
