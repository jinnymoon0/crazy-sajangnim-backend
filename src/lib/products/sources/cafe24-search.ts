import * as cheerio from "cheerio";
import pLimit from "p-limit";

import {
  getActiveBrands,
} from "@/lib/products/brand-registry";
import type { BrandRecord } from "@/lib/products/brand-repository";
import { getRetailers } from "@/lib/products/retailer-repository";
import { parseCafe24Products } from "@/lib/products/retailers/cafe24";
import type { Product } from "@/types/product";

import { dedupeProducts, fetchWithTimeout, resolveGender } from "./shared";

/*
 * Korean boutique stockists on the Cafe24 platform whose public search
 * pages are parseable by the existing Cafe24 retailer adapter.
 */
/*
 * The shops this list held now live in the retailers table, so a cafe24
 * shop found while adding a brand is crawled from the next run onwards.
 * Kept as the fallback for when the table cannot be read.
 */
const CAFE24_STORES = ["8division.com", "sculpstore.com"];

const MAX_PAGES_PER_QUERY = 2;

async function crawlStoreBrand(
  domain: string,
  brand: BrandRecord,
): Promise<Product[]> {
  const products: Product[] = [];

  for (let page = 1; page <= MAX_PAGES_PER_QUERY; page += 1) {
    const pageUrl =
      `https://${domain}/product/search.html?` +
      new URLSearchParams({
        keyword: brand.englishName,
        page: String(page),
      }).toString();

    let html: string;

    try {
      const response = await fetchWithTimeout(pageUrl, {
        accept: "text/html,application/xhtml+xml",
        timeoutMs: 20_000,
      });

      if (!response.ok) {
        break;
      }

      html = await response.text();
    } catch {
      break;
    }

    const $ = cheerio.load(html);

    const parsed = parseCafe24Products({
      $,
      html,
      pageUrl,
      market: "KR",
      requestedGender: "MEN",
      brandSlug: brand.slug,
      brandName: brand.englishName,
      maxProducts: 200,
    });

    if (parsed.length === 0) {
      break;
    }

    /*
     * The adapter stamps the requested gender. A brand-search listing has no
     * requested gender, so reclassify each item from its own name and let
     * UNISEX rows surface in both segments.
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

export async function collectCafe24Products(
  brands: BrandRecord[] = getActiveBrands(),
): Promise<Product[]> {
  const limit = pLimit(4);

  const stored = await getRetailers("cafe24");

  const domains =
    stored.length > 0
      ? stored.map((retailer) => retailer.domain)
      : CAFE24_STORES;

  const tasks = domains.flatMap((domain) =>
    brands.map((brand) => limit(() => crawlStoreBrand(domain, brand))),
  );

  const results = await Promise.allSettled(tasks);

  return dedupeProducts(
    results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    ),
  );
}
