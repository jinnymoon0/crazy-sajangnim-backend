-- Remember which item a post is about.
--
-- Sharing a product filled the compose form with its name and picture
-- and then forgot it. The post kept the words and lost the thing, so
-- arriving at the blog from a specific item showed a feed about
-- everything except that item — the one question a person who just
-- clicked "share on blog" is asking.
--
-- The display fields are copied rather than looked up. A sale listing
-- is gone from the catalogue within weeks, and a conversation about a
-- jacket should still show the jacket a year later. A foreign key to
-- product_catalog would turn every old post into a blank card.

alter table public.blog_posts
  add column if not exists product_id         text,
  add column if not exists product_url        text,
  add column if not exists product_brand      text,
  add column if not exists product_name       text,
  add column if not exists product_image_url  text,
  add column if not exists product_market     text,
  add column if not exists product_currency   text,
  add column if not exists product_sale_price numeric,
  add column if not exists product_original_price numeric;

/*
 * The lookup this exists to serve: every post about one item, newest
 * first. Without it each product page scans the whole table.
 */
create index if not exists blog_posts_product_id_idx
  on public.blog_posts (product_id, created_at desc);

/*
 * Same closed list as the catalogue, so a post cannot claim a
 * storefront that does not exist. Null is allowed throughout: a post
 * written from the blog rather than from an item is about nothing in
 * particular, which is still a legitimate post.
 */
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'blog_posts_product_market_check'
  ) then
    alter table public.blog_posts
      add constraint blog_posts_product_market_check
      check (product_market is null or product_market in ('US', 'KR', 'JP'));
  end if;
end $$;

select
  count(*)                                        as posts,
  count(product_id)                               as posts_about_an_item,
  (select count(*) from information_schema.columns
    where table_name = 'blog_posts'
      and column_name like 'product_%')            as product_columns
from public.blog_posts;
