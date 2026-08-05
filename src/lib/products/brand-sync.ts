import { getSupabaseAdmin } from "@/lib/supabase/admin";

/*
 * Keeping the catalog and the brand list telling the same story.
 *
 * Products carry the brand they were filed under at collection time,
 * and nothing used to revisit that. Removing a brand left its products
 * in place — still served, still labelled, but belonging to a brand the
 * system no longer knows. The shop builds its filters from the catalog,
 * so those products went on being offered under a brand that could not
 * be looked up, which is how slip-ons stayed filed under ON after ON
 * had been removed.
 *
 * Drift is therefore a first-class thing to detect rather than a state
 * to be assumed impossible.
 */

export interface BrandDrift {
  /* Filed in the catalog under a brand that is not tracked. */
  orphaned: { slug: string; products: number }[];

  /* Tracked, but nothing on sale to show for it. */
  empty: string[];

  /* Every brand slug seen in the catalog. */
  catalogBrands: number;

  /* Every brand in the brands table. */
  trackedBrands: number;
}

/*
 * A response is capped at a thousand rows however large a limit is
 * asked for, so the catalog is read in pages. Counting rows from a
 * single unpaged read is what made brand counts wrong before: it
 * silently stopped at the cap, and rows come back oldest first, so the
 * brands that read as empty were the ones added most recently.
 */
const PAGE_SIZE = 1000;

async function readAllBrandSlugs(): Promise<string[]> {
  const supabase = getSupabaseAdmin();

  const slugs: string[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("product_catalog")
      .select("brand_slug")
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Could not read the catalog: ${error.message}`);
    }

    const page = data ?? [];

    slugs.push(
      ...page
        .map((row) => (row as { brand_slug: string | null }).brand_slug)
        .filter((slug): slug is string => Boolean(slug)),
    );

    if (page.length < PAGE_SIZE) {
      return slugs;
    }
  }
}

export async function findBrandDrift(): Promise<BrandDrift> {
  const supabase = getSupabaseAdmin();

  const { data: brandRows, error: brandError } = await supabase
    .from("brands")
    .select("slug");

  if (brandError) {
    throw new Error(`Could not read the brands: ${brandError.message}`);
  }

  const tracked = new Set(
    (brandRows ?? []).map((row) => (row as { slug: string }).slug),
  );

  const counts = new Map<string, number>();

  for (const slug of await readAllBrandSlugs()) {
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }

  const orphaned = [...counts.entries()]
    .filter(([slug]) => !tracked.has(slug))
    .map(([slug, products]) => ({ slug, products }))
    .sort((a, b) => b.products - a.products);

  const empty = [...tracked].filter((slug) => !counts.has(slug)).sort();

  return {
    orphaned,
    empty,
    catalogBrands: counts.size,
    trackedBrands: tracked.size,
  };
}

/*
 * Remove every product filed under a brand that is not tracked.
 *
 * Deliberately not automatic. A brand can be missing because it was
 * deliberately removed, or because someone is midway through renaming
 * it, and silently deleting hundreds of rows on a schedule would make
 * the second case unrecoverable. The caller decides.
 */
export async function purgeOrphanedProducts(
  slugs: string[],
): Promise<{ slug: string; removed: number }[]> {
  if (slugs.length === 0) {
    return [];
  }

  const supabase = getSupabaseAdmin();

  const removed: { slug: string; removed: number }[] = [];

  for (const slug of slugs) {
    const { data, error } = await supabase
      .from("product_catalog")
      .delete()
      .eq("brand_slug", slug)
      .select("id");

    if (error) {
      throw new Error(`Could not remove ${slug}: ${error.message}`);
    }

    removed.push({ slug, removed: (data ?? []).length });
  }

  return removed;
}
