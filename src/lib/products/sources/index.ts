import type { Market, Product } from "@/types/product";
import type { BrandRecord } from "@/lib/products/brand-repository";
import { getActiveBrands } from "@/lib/products/brand-registry";

import { collectCafe24Products } from "./cafe24-search";
import { collectGarmentoryProducts } from "./garmentory";
import { collectHbxProducts } from "./hbx";
import { collectBrandStoreProducts } from "./brand-stores";
import { collectEndClothingProducts } from "./end-clothing";
import { collectMusinsaProducts } from "./musinsa";
import { collectOkmallProducts } from "./okmall";
import { collectTwentyNineCmProducts } from "./twenty-nine-cm";
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
  /*
   * One set per storefront. This was a two-way choice on "is it Korea",
   * so Japan fell to the American branch and collected American shops —
   * a run that reported seven hundred products and put every one of
   * them in the wrong country.
   */
  const byMarket: Record<Market, Array<() => Promise<Product[]>>> = {
    KR: [
      () => collectCafe24Products(brands),
      () => collectOkmallProducts(brands),
      () => collectMusinsaProducts(brands),
      () => collectTwentyNineCmProducts(brands),
      () => collectBrandStoreProducts(market, brands),
      () => collectEndClothingProducts(market),
    ],

    US: [
      () => collectShopifyProducts(market),
      () => collectGarmentoryProducts(brands),
      () => collectHbxProducts(brands),
      () => collectBrandStoreProducts(market, brands),
      () => collectEndClothingProducts(market),
    ],

    /*
     * Japan has no scraper of its own yet. The two biggest names —
     * ZOZOTOWN and Rakuten — publish no catalogue to read, so what is
     * here is what can be read: END's Japanese storefront, the brands'
     * own Japanese shops, and any Shopify shop discovery has found
     * pricing in yen.
     */
    JP: [
      () => collectShopifyProducts(market),
      () => collectBrandStoreProducts(market, brands),
      () => collectEndClothingProducts(market),
    ],
  };

  const collectors = byMarket[market];

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
