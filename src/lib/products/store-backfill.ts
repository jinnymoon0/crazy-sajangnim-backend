import { getBrands } from "@/lib/products/brand-repository";
import { discoverBrandStore } from "@/lib/products/brand-store-discovery";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/*
 * Look again for the shops we failed to find the first time.
 *
 * Store discovery runs once, when a brand is added, and a failure is
 * caught and logged rather than retried. So a brand added during any
 * outage keeps store_domain null for ever, however findable its shop
 * becomes afterwards — the record is wrong and nothing ever revisits it.
 *
 * KLEESIER is what this is for. It was re-added while search was
 * misconfigured, discovery threw, and it sat with no shop and no items
 * for hours. Running the same discovery by hand afterwards found
 * kleesier.com on the first attempt and collected 42 sale items. The
 * prober was never wrong; nothing asked it twice.
 */

/* Probing a brand walks up to two dozen domains, so a run takes one. */
const PER_RUN = 1;

export interface BackfillResult {
  considered: number;
  attempted: string[];
  found: { slug: string; domain: string; platform: string }[];
}

export async function backfillMissingStores(
  hour: number,
): Promise<BackfillResult> {
  const brands = await getBrands();

  /*
   * Sorted, so the rotation below is stable between runs. Without it the
   * order is whatever the database returns and a brand could be probed
   * twice a day while another is never reached.
   */
  const missing = brands
    .filter((brand) => !brand.storeDomain)
    .sort((a, b) => a.slug.localeCompare(b.slug));

  if (missing.length === 0) {
    return { considered: 0, attempted: [], found: [] };
  }

  /*
   * One per hour, chosen by the clock rather than a counter, so a missed
   * run does not shift the rotation and every brand comes round on a
   * fixed cycle — about a day for the twenty or so without a shop.
   *
   * Deliberately cheap. This rides on the hourly collection, and a
   * backfill that made that slower would trade a catalogue that is
   * occasionally missing a brand for one that is always behind.
   */
  const attempted: string[] = [];
  const found: BackfillResult["found"] = [];

  for (let n = 0; n < PER_RUN; n += 1) {
    const brand = missing[(hour + n) % missing.length];

    if (!brand || attempted.includes(brand.slug)) {
      continue;
    }

    attempted.push(brand.slug);

    try {
      const store = await discoverBrandStore(brand.englishName, brand.slug);

      if (!store) {
        continue;
      }

      const { error } = await getSupabaseAdmin()
        .from("brands")
        .update({
          store_domain: store.domain,
          store_platform: store.platform,
          store_market: store.market,
        })
        .eq("slug", brand.slug);

      if (error) {
        console.error(
          `Backfill found ${store.domain} for ${brand.slug} but could not save it:`,
          error.message,
        );

        continue;
      }

      console.log(
        `Backfill attached ${store.domain} (${store.platform}) to ${brand.slug}.`,
      );

      found.push({
        slug: brand.slug,
        domain: store.domain,
        platform: store.platform,
      });
    } catch (error) {
      /*
       * Never fatal. This runs alongside the collection, and a brand
       * whose shop is unreachable must not stop the catalogue being
       * refreshed — that is the failure this whole file exists to undo.
       */
      console.error(`Backfill failed for ${brand.slug}:`, error);
    }
  }

  return { considered: missing.length, attempted, found };
}
