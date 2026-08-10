-- Make the scheduler's own records readable from outside the database.
--
-- The whole argument for moving the schedule into Postgres was that a
-- run which does not happen leaves a record. That was only half true:
-- pg_cron writes to cron.job_run_details and pg_net writes to
-- net._http_response, and neither schema is exposed over PostgREST — so
-- the record existed and nothing outside the SQL editor could read it.
-- The first time a run went missing that gap cost a round trip.
--
-- Read-only. Nothing here can schedule, unschedule, or send anything.

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
    /*
     * Did the schedule fire, and did the function raise? A failed run
     * records its exception text here, which is the difference between
     * "never fired" and "fired and threw" — the distinction that two
     * previous schedulers hid.
     */
    select
      'cron'::text as source,
      d.start_time as at,
      ('status=' || d.status || ' ' || coalesce(d.return_message, ''))::text as detail
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
    where j.jobname = 'refresh-catalog-hourly'

    union all

    /*
     * And did the outbound request actually reach the service. A 401
     * here means the token in Vault and the token in the deployment
     * have drifted; a timeout means the collection outlived the window;
     * nothing at all means pg_net never sent it.
     */
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
  limit 25;
$$;

-- Read the definition of a function that lives only in the database.
--
-- deactivate_stale_products() was found on the schedule with no source
-- anywhere in this repository. It is almost certainly what set
-- is_available = false across the whole catalog while the collection
-- was stalled — a job doing its job against data nothing was
-- refreshing. Anything that can empty the storefront should be legible
-- without opening the dashboard.
create or replace function public.function_source(fn text)
returns text
language sql
security definer
set search_path = public, extensions
as $$
  select pg_get_functiondef(p.oid)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = fn
  limit 1;
$$;

-- The schedule as it currently stands, so "is it still registered" is
-- answerable without opening the dashboard.
create or replace function public.cron_schedule_state()
returns table (
  jobname  text,
  schedule text,
  active   boolean,
  command  text
)
language sql
security definer
set search_path = public, extensions
as $$
  select j.jobname::text, j.schedule::text, j.active, j.command::text
  from cron.job j
  order by j.jobname;
$$;
