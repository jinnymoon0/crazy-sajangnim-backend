-- Shops the collector reads, including ones found by looking for a
-- brand rather than added by hand.
--
-- The Shopify stockists were a list in the code, so carrying a new brand
-- meant editing and redeploying. They live here now, and adding a brand
-- can put a shop beside them once the shop has been shown to stock it.

create table if not exists public.retailers (
  id uuid primary key default gen_random_uuid(),

  domain text not null unique,

  -- How to read it: shopify or cafe24.
  platform text not null,

  -- Which storefront its prices belong to, decided by the currency it
  -- charges in — never guessed from the domain.
  market text not null,

  -- Where a shop sells to one department only.
  default_gender text not null default 'UNISEX',

  is_active boolean not null default true,

  -- 'seed' for the ones that were in the code, 'search' for a shop
  -- found while adding a brand, 'manual' for one added by hand.
  discovered_via text not null default 'manual',

  -- The brand whose addition turned this shop up. Not a claim about
  -- what else it carries.
  discovered_for text,

  -- Last time the brand it was found for was actually seen on it, so a
  -- shop that stops carrying anything can be spotted.
  last_verified_at timestamptz,

  created_at timestamptz not null default now(),

  constraint retailers_platform_check
    check (platform in ('shopify', 'cafe24')),

  constraint retailers_market_check
    check (market in ('US', 'KR')),

  constraint retailers_gender_check
    check (default_gender in ('MEN', 'WOMEN', 'UNISEX'))
);

create index if not exists retailers_active_idx
  on public.retailers (is_active, market);

alter table public.retailers enable row level security;

-- The stockists that were hardcoded, so nothing is lost when the
-- collector starts reading this table instead.
insert into public.retailers (domain, platform, market, default_gender, discovered_via)
values
  ('svrn.com',                    'shopify', 'US', 'UNISEX', 'seed'),
  ('mohawkgeneralstore.com',      'shopify', 'US', 'UNISEX', 'seed'),
  ('notre-shop.com',              'shopify', 'US', 'UNISEX', 'seed'),
  ('standardandstrange.com',      'shopify', 'US', 'MEN',    'seed'),
  ('blueowl.us',                  'shopify', 'US', 'MEN',    'seed'),
  ('unionlosangeles.com',         'shopify', 'US', 'MEN',    'seed'),
  ('stagprovisions.com',          'shopify', 'US', 'MEN',    'seed'),
  ('snakeoilprovisions.com',      'shopify', 'US', 'MEN',    'seed'),
  ('featuresneakerboutique.com',  'shopify', 'US', 'MEN',    'seed'),
  ('8division.com',               'cafe24',  'KR', 'UNISEX', 'seed'),
  ('sculpstore.com',              'cafe24',  'KR', 'UNISEX', 'seed')
on conflict (domain) do nothing;
