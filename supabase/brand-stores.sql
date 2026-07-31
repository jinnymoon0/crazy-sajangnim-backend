-- A brand's own online store, discovered when the brand is added.
--
-- Smaller labels are rarely discounted by the big platforms, so their
-- own shop is where their sales are.

alter table public.brands
  add column if not exists store_domain text,
  add column if not exists store_platform text,
  add column if not exists store_market text;

comment on column public.brands.store_domain is
  'Host of the brand''s own shop, e.g. nuuanu.kr';

comment on column public.brands.store_platform is
  'How to read that shop: cafe24 or shopify';

comment on column public.brands.store_market is
  'Which storefront the shop''s prices belong to: US or KR';
