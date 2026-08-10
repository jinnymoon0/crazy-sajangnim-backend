-- Refresh the catalog hourly, scheduled by the database itself.
--
-- Why here rather than in a CI runner or the hosting platform. Both of
-- the schedulers tried before failed silently for weeks: four Vercel
-- cron jobs never fired at all, and the GitHub workflow fired but died
-- on a missing secret after a repository transfer. Postgres is already
-- running, already holds the data, and its scheduler is visible in a
-- table anyone can query — so a run that does not happen leaves a
-- record, which is the part that was missing every previous time.
--
-- Run this once in the Supabase SQL editor. It is safe to re-run: the
-- job is unscheduled before being recreated.

-- pg_cron schedules; pg_net makes the outbound call. Both ship with
-- Supabase and only need enabling.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- The bearer token lives in Vault rather than in the job definition, so
-- it is not sitting in plain text in cron.job for anyone who can read
-- the schedule. Store it first — see the companion command in the
-- instructions, which is deliberately not committed here.
--
--   select vault.create_secret('<the CRON_SECRET value>', 'cron_secret');

create or replace function public.refresh_catalog_hourly()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret   text;
  v_market   text;
  v_gender   text;
  v_slot     int;
  v_base     text := 'https://crazy-sajangnim-backend.vercel.app';
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_secret'
  limit 1;

  if v_secret is null then
    raise exception
      'cron_secret is not in Vault. Run: select vault.create_secret(''<value>'', ''cron_secret'');';
  end if;

  /*
   * One storefront per hour, rotating. A full pass takes about five
   * minutes and walks every retailer we read; four sweeps an hour is
   * ninety-six a day against shops that already answer 429 when
   * pushed. Rotating spreads that load rather than multiplying it, and
   * each storefront still comes round every four hours — six times a
   * day, against once a day before any of this.
   *
   * Keyed on the hour rather than a counter, so a missed run does not
   * shift the rotation.
   */
  v_slot := (extract(hour from now() at time zone 'utc')::int) % 4;

  v_market := case when v_slot < 2 then 'US' else 'KR' end;
  v_gender := case when v_slot % 2 = 0 then 'MEN' else 'WOMEN' end;

  /*
   * Fire and forget. The collection takes a minute or two and pg_net
   * is asynchronous, so the request continues on the service even if
   * this call stops waiting. The response lands in net._http_response,
   * which is where to look when a run seems to have done nothing.
   */
  perform net.http_get(
    url := v_base || '/api/cron/refresh-products?market=' || v_market ||
           '&gender=' || v_gender,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'User-Agent', 'crazy-sajangnim-pg-cron/1.0'
    ),
    timeout_milliseconds := 300000
  );
end;
$$;

-- Recreate cleanly, so re-running this file does not leave duplicates
-- quietly collecting twice an hour.
select cron.unschedule('refresh-catalog-hourly')
where exists (
  select 1 from cron.job where jobname = 'refresh-catalog-hourly'
);

select cron.schedule(
  'refresh-catalog-hourly',
  '0 * * * *',
  $$select public.refresh_catalog_hourly();$$
);
