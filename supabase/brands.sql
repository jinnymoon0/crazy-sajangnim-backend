-- Tracked clothing brands.
--
-- Brands used to live in src/constants/brands.ts. They now live here so
-- they can be added from the admin dashboard without a deploy; the
-- constant remains as the seed for a fresh database.

create table if not exists public.brands (
  slug text primary key,
  english_name text not null,
  korean_name text,
  aliases text[] not null default '{}',
  is_active boolean not null default true,
  added_by text,
  created_at timestamptz not null default now(),

  constraint brands_slug_format
    check (slug ~ '^[a-z0-9-]{2,60}$'),

  constraint brands_english_name_length
    check (char_length(english_name) between 1 and 80)
);

create index if not exists brands_active_idx
  on public.brands (is_active, slug);

-- Only ever read and written through the service role on the server.
alter table public.brands enable row level security;
