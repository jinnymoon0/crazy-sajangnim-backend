-- The rest of the tables that only knew about two countries.
--
-- add-japan.sql relaxed product_catalog and stopped there, which was
-- half the job: retailers has its own check, and so does the brands
-- column that records where a brand's own shop sells. Seeding a
-- Japanese retailer failed with 23514 exactly the way a Japanese
-- product did, one table further along.
--
-- Written to find the constraints rather than name them. They were
-- created inline with their tables and carry whatever name Postgres
-- chose, and the point of this file is to catch the ones I have not
-- thought of as well as the two I have.

do $$
declare
  c record;
  fixed int := 0;
begin
  for c in
    select rel.relname as table_name,
           con.conname  as constraint_name,
           pg_get_constraintdef(con.oid) as definition
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and con.contype = 'c'
      /*
       * Any check that names a market column and lists the two
       * countries. Matching on the values as well as the column keeps
       * this off constraints that merely mention the word.
       */
      and pg_get_constraintdef(con.oid) ~* '(market)'
      and pg_get_constraintdef(con.oid) ~* '''US'''
      and pg_get_constraintdef(con.oid) ~* '''KR'''
      and pg_get_constraintdef(con.oid) !~* '''JP'''
  loop
    execute format('alter table public.%I drop constraint %I',
                   c.table_name, c.constraint_name);

    /*
     * Rebuilt from the old definition with Japan added, so a constraint
     * on a column this file has never heard of is still repaired
     * correctly — including the nullable ones, where the original
     * allowed null and the replacement must too.
     */
    execute format('alter table public.%I add constraint %I %s',
                   c.table_name,
                   c.constraint_name,
                   replace(c.definition, '''KR''', '''KR'', ''JP'''));

    raise notice 'updated % on %', c.constraint_name, c.table_name;

    fixed := fixed + 1;
  end loop;

  raise notice 'constraints updated: %', fixed;
end $$;

-- Every check still mentioning a market, so the result shows whether
-- any were missed rather than only what was changed.
select
  rel.relname                        as table_name,
  con.conname                        as constraint_name,
  pg_get_constraintdef(con.oid)      as definition,
  pg_get_constraintdef(con.oid) ~* '''JP''' as allows_japan
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and con.contype = 'c'
  and pg_get_constraintdef(con.oid) ~* '(market|currency)'
order by rel.relname, con.conname;
