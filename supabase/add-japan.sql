-- Let Japan into the catalogue.
--
-- market and currency are pinned by check constraints written when there
-- were two storefronts. Inserting a JP row fails with 23514 before any
-- application code gets a say, so this has to run before the collectors
-- that produce Japanese products are deployed.
--
-- The constraints are found by what they check rather than by name,
-- because they were created inline with the table and carry whatever
-- name Postgres chose at the time. Re-running this is safe.

do $$
declare
  c record;
begin
  for c in
    select con.conname, rel.relname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'product_catalog'
      and con.contype = 'c'
      and (
        pg_get_constraintdef(con.oid) ilike '%market%'
        or pg_get_constraintdef(con.oid) ilike '%currency%'
      )
  loop
    execute format(
      'alter table public.%I drop constraint %I', c.relname, c.conname
    );

    raise notice 'dropped % on %', c.conname, c.relname;
  end loop;
end $$;

/*
 * Rewritten with Japan included. Still a closed list: the collectors
 * infer a market from the currency a shop prices in, and a typo there
 * would otherwise create a storefront nobody can reach rather than
 * failing loudly.
 */
alter table public.product_catalog
  add constraint product_catalog_market_check
  check (market in ('US', 'KR', 'JP'));

alter table public.product_catalog
  add constraint product_catalog_currency_check
  check (currency in ('USD', 'KRW', 'JPY'));

/*
 * The hourly refresh rotates one storefront per hour. Six now rather
 * than four, so each still comes round — every six hours instead of
 * four. Keyed on the hour, so a missed run does not shift the rotation.
 */
create or replace function public.refresh_catalog_hourly()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_market text;
  v_gender text;
  v_slot   int;
  v_base   text := 'https://crazy-sajangnim-backend.vercel.app';
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_secret'
  limit 1;

  if v_secret is null then
    raise exception
      'cron_secret is not in Vault. Run: select vault.create_secret(''<value>'', ''cron_secret'');';
  end if;

  v_slot := (extract(hour from now() at time zone 'utc')::int) % 6;

  v_market := case
    when v_slot < 2 then 'US'
    when v_slot < 4 then 'KR'
    else 'JP'
  end;

  v_gender := case when v_slot % 2 = 0 then 'MEN' else 'WOMEN' end;

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

-- What the catalogue now allows, so the result says whether it worked.
select
  (select count(*) from public.product_catalog where market = 'US') as us_rows,
  (select count(*) from public.product_catalog where market = 'KR') as kr_rows,
  (select count(*) from public.product_catalog where market = 'JP') as jp_rows,
  (select string_agg(con.conname, ', ')
     from pg_constraint con
     join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'product_catalog' and con.contype = 'c') as checks;
