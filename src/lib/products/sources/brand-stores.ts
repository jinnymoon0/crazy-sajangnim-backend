import * as cheerio from "cheerio";
import pLimit from "p-limit";

import { getActiveBrands } from "@/lib/products/brand-registry";
import type { BrandRecord } from "@/lib/products/brand-repository";
import { parseCafe24Products } from "@/lib/products/retailers/cafe24";
import type { Market, Product } from "@/types/product";

import { dedupeProducts, fetchWithTimeout, resolveGender } from "./shared";

interface BrandStore {
  domain: string;
  brandSlug: string;
  market: Market;
}

/*
 * Shops run by a single label. The big platforms rarely discount these
 * smaller brands, so their own store is where the sales are.
 */
const BRAND_STORES: BrandStore[] = [
  { domain: "nuuanu.kr", brandSlug: "nuuanu", market: "KR" },
];

/*
 * A label's own shop does not tag products with its own name, so
 * searching for the brand returns nothing. Enumerate the catalogue by
 * garment instead.
 */
const CATALOGUE_TERMS = [
  "skirt",
  "top",
  "dress",
  "pants",
  "jacket",
  "shirt",
  "knit",
  "bag",
];

const MAX_PRODUCTS_PER_TERM = 60;

async function crawlStore(
  store: BrandStore,
  brand: BrandRecord,
): Promise<Product[]> {
  const products: Product[] = [];

  for (const term of CATALOGUE_TERMS) {
    const pageUrl = `https://${store.domain}/product/search.html?keyword=${encodeURIComponent(term)}`;

    let html: string;

    try {
      const response = await fetchWithTimeout(pageUrl, {
        accept: "text/html,application/xhtml+xml",
        timeoutMs: 20_000,
      });

      if (!response.ok) {
        continue;
      }

      html = await response.text();
    } catch {
      continue;
    }

    const $ = cheerio.load(html);

    const parsed = parseCafe24Products({
      $,
      html,
      pageUrl,
      market: store.market,
      requestedGender: "WOMEN",
      brandSlug: brand.slug,
      brandName: brand.englishName,
      maxProducts: MAX_PRODUCTS_PER_TERM,
      trustStoreBrand: true,
    });

    /*
     * The adapter stamps the requested gender; a catalogue listing has
     * none, so classify from the product name and let unisex pieces
     * show in both segments.
     */
    products.push(
      ...parsed.map((product) => ({
        ...product,
        gender: resolveGender(product.productName, "UNISEX"),
      })),
    );
  }

  return products;
}

export async function collectBrandStoreProducts(
  market: Market,
  brands: BrandRecord[] = getActiveBrands(),
): Promise<Product[]> {
  const stores = BRAND_STORES.filter((store) => store.market === market);

  const tasks = stores.flatMap((store) => {
    const brand = brands.find(
      (candidate) => candidate.slug === store.brandSlug,
    );

    return brand ? [{ store, brand }] : [];
  });

  if (tasks.length === 0) {
    return [];
  }

  const limit = pLimit(2);

  const results = await Promise.allSettled(
    tasks.map(({ store, brand }) => limit(() => crawlStore(store, brand))),
  );

  return dedupeProducts(
    results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    ),
  );
}
