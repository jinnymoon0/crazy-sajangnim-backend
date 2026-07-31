import type { Market, Product } from "@/types/product";
import type { BrandRecord } from "@/lib/products/brand-repository";
import { getActiveBrands } from "@/lib/products/brand-registry";

import { collectCafe24Products } from "./cafe24-search";
import { collectGarmentoryProducts } from "./garmentory";
import { collectHbxProducts } from "./hbx";
import { collectOkmallProducts } from "./okmall";
import { collectShopifyProducts } from "./shopify";
import { dedupeProducts } from "./shared";

/*
 * Crawl retailer catalogs directly instead of discovering pages through a
 * search engine. Direct endpoints are deterministic, expose the retailer's
 * own sale/original price pairs (so every product is VERIFIED), and are
 * immune to search-engine rate limiting.
 *
 * Returned products span every gender (including UNISEX, which the catalog
 * read path shows in both gender segments); callers persist them all.
 */
export async function collectDirectProducts(
  market: Market,
  brands: BrandRecord[] = getActiveBrands(),
): Promise<Product[]> {
  /*
   * Shopify scans whole store catalogues and filters by brand matcher,
   * so it takes no brand list; the others query per brand and can be
   * narrowed to one, which is what adding a single brand does.
   */
  const collectors: Array<() => Promise<Product[]>> =
    market === "KR"
      ? [
          () => collectCafe24Products(brands),
          () => collectOkmallProducts(brands),
        ]
      : [
          () => collectShopifyProducts(),
          () => collectGarmentoryProducts(brands),
          () => collectHbxProducts(brands),
        ];

  const results = await Promise.allSettled(
    collectors.map((collect) => collect()),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Direct source collector failed:", result.reason);
    }
  }

  return dedupeProducts(
    results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    ),
  );
}
