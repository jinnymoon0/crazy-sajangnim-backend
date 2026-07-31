import type { Market, Product } from "@/types/product";

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
): Promise<Product[]> {
  const collectors =
    market === "KR"
      ? [collectCafe24Products, collectOkmallProducts]
      : [collectShopifyProducts, collectGarmentoryProducts, collectHbxProducts];

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
