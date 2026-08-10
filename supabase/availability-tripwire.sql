-- Record who empties the catalog.
--
-- On 10 August 1,359 products went from available to unavailable
-- inside a forty-minute window and nothing could say what did it. The
-- scheduled job had not run — its history shows 19:30 daily and the
-- most recent was the night before. No code in any of the three
-- repositories writes is_available = false; every collector hardcodes
-- true. There is no trigger doing it: a dead row set back to true
-- stayed true. The service-role call made from the laptop measured the
-- same count before and after. Something applied the exact three-day
-- rule and left no trace.
--
-- The circuit breaker added alongside this only guards the scheduled
-- path. Whatever did this was not on that path, so the breaker would
-- not have stopped it. This does not stop it either — it makes the next
-- occurrence say its own name.
--
-- Deliberately a statement trigger rather than an hourly snapshot. A
-- snapshot would have shown the same thing the forensics already
-- showed: that the count changed sometime between two readings. What
-- was missing was the actor, and only the writing session knows that.

create table if not exists public.availability_audit (
  id               bigserial primary key,
  at               timestamptz not null default now(),
  rows_deactivated bigint      not null,
  rows_activated   bigint      not null,
  db_user          text        not null,
  application_name text,
  client_addr      inet,
  query            text
);

-- Consistent with every other table here: on, with no policies, so
-- only the service role reaches it.
alter table public.availability_audit enable row level security;

create index if not exists availability_audit_at_idx
  on public.availability_audit (at desc);

create or replace function public.audit_availability_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_off bigint;
  v_on  bigint;
begin
  select
    count(*) filter (where o.is_available and not n.is_available),
    count(*) filter (where not o.is_available and n.is_available)
  into v_off, v_on
  from old_rows o
  join new_rows n on n.id = o.id;

  /*
   * A hundred. Ordinary collection touches thousands of rows a run but
   * flips almost none of them — every collector writes true, so a
   * refresh moves availability only for products coming back in stock.
   * Below a hundred is business as usual and logging it would bury the
   * event this exists to catch.
   */
  if v_off >= 100 or v_on >= 100 then
    insert into public.availability_audit (
      rows_deactivated, rows_activated,
      db_user, application_name, client_addr, query
    )
    values (
      v_off, v_on,
      current_user,
      current_setting('application_name', true),
      inet_client_addr(),
      left(current_query(), 500)
    );
  end if;

  return null;
end;
$$;

-- Statement-level, with transition tables, so the whole update is one
-- row in the audit rather than one per product.
drop trigger if exists trg_audit_availability on public.product_catalog;

create trigger trg_audit_availability
after update on public.product_catalog
referencing old table as old_rows new table as new_rows
for each statement
execute function public.audit_availability_change();
