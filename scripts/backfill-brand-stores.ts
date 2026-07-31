/*
 * Find and remember the shop each tracked brand runs itself.
 *
 * Brands added before store discovery existed have no shop on file, so
 * every collection re-searches for one. This fills them in once.
 *
 *   npx tsx scripts/backfill-brand-stores.ts
 */

async function main() {
  const { getBrands } = await import("../src/lib/products/brand-repository");
  const { discoverBrandStore } = await import(
    "../src/lib/products/brand-store-discovery"
  );
  const { getSupabaseAdmin } = await import("../src/lib/supabase/admin");

  const brands = await getBrands({ includeInactive: true });
  const supabase = getSupabaseAdmin();

  let found = 0;

  for (const brand of brands) {
    if (brand.storeDomain) {
      console.log(`${brand.englishName}: already has ${brand.storeDomain}`);

      continue;
    }

    const store = await discoverBrandStore(brand.englishName, brand.slug);

    if (!store) {
      console.log(`${brand.englishName}: no shop found`);

      continue;
    }

    const { error } = await supabase
      .from("brands")
      .update({
        store_domain: store.domain,
        store_platform: store.platform,
        store_market: store.market,
      })
      .eq("slug", brand.slug);

    if (error) {
      console.error(`${brand.englishName}: could not save — ${error.message}`);

      continue;
    }

    found += 1;

    console.log(
      `${brand.englishName}: saved ${store.domain} (${store.platform}, ${store.market})`,
    );
  }

  console.log(`\n${found} shops saved across ${brands.length} brands.`);
}

main();
