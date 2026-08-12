import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import pLimit from "p-limit";

import { getActiveBrands } from "@/lib/products/brand-registry";
import { isBrandVendor } from "@/lib/products/brand-store-discovery";
import type { BrandRecord } from "@/lib/products/brand-repository";
import { inferCategory } from "@/lib/products/infer-category";
import { parseCafe24Products } from "@/lib/products/retailers/cafe24";
import { calculateDiscountPercentage } from "@/lib/utils";
import type { Market, Product } from "@/types/product";
import { CURRENCY_BY_MARKET } from "@/lib/products/markets";

import {
  dedupeProducts,
  fetchWithTimeout,
  isReasonablePrice,
  resolveGender,
} from "./shared";

/*
 * A label's own shop does not tag products with its own name, so
 * searching it for the brand returns nothing. Enumerate the catalogue
 * by garment instead.
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
const MAX_SHOPIFY_PAGES = 6;

async function crawlCafe24Store(
  domain: string,
  brand: BrandRecord,
  market: Market,
): Promise<Product[]> {
  const products: Product[] = [];

  for (const term of CATALOGUE_TERMS) {
    const pageUrl = `https://${domain}/product/search.html?keyword=${encodeURIComponent(term)}`;

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
      market,
      requestedGender: "WOMEN",
      brandSlug: brand.slug,
      brandName: brand.englishName,
      maxProducts: MAX_PRODUCTS_PER_TERM,
      trustStoreBrand: true,
    });

    products.push(
      ...parsed.map((product) => ({
        ...product,
        gender: resolveGender(product.productName, "UNISEX"),
      })),
    );
  }

  return products;
}

interface ShopifyVariant {
  price?: string;
  compare_at_price?: string | null;
  available?: boolean;
}

interface ShopifyProduct {
  title?: string;
  vendor?: string;
  handle?: string;
  product_type?: string;
  tags?: string[] | string;
  variants?: ShopifyVariant[];
  images?: { src?: string }[];
}

function parsePrice(value: string | null | undefined): number | null {
  if (!value || !/^\d+(\.\d{1,2})?$/.test(value.trim())) {
    return null;
  }

  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function crawlShopifyStore(
  domain: string,
  brand: BrandRecord,
  market: Market,
): Promise<Product[]> {
  const products: Product[] = [];

  for (let page = 1; page <= MAX_SHOPIFY_PAGES; page += 1) {
    let items: ShopifyProduct[];

    try {
      const response = await fetchWithTimeout(
        `https://${domain}/products.json?limit=250&page=${page}`,
      );

      if (!response.ok) {
        break;
      }

      const body = (await response.json()) as {
        products?: ShopifyProduct[];
      };

      items = body.products ?? [];
    } catch {
      break;
    }

    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      const title = item.title?.trim();
      const handle = item.handle?.trim();

      if (!title || !handle) {
        continue;
      }

      /*
       * Some labels sell other brands alongside their own. Their items
       * belong to those brands, not to the shop's owner, so take only
       * what the shop lists under the brand itself.
       */
      if (!isBrandVendor(item.vendor, brand.englishName)) {
        continue;
      }

      const saleVariant = (item.variants ?? []).find((variant) => {
        if (variant.available === false) {
          return false;
        }

        const price = parsePrice(variant.price);
        const compareAt = parsePrice(variant.compare_at_price ?? null);

        return price !== null && compareAt !== null && compareAt > price;
      });

      if (!saleVariant) {
        continue;
      }

      const salePrice = parsePrice(saleVariant.price);
      const originalPrice = parsePrice(saleVariant.compare_at_price ?? null);

      if (
        !salePrice ||
        !originalPrice ||
        !isReasonablePrice(salePrice, market) ||
        originalPrice <= salePrice
      ) {
        continue;
      }

      const discountPercentage = calculateDiscountPercentage(
        originalPrice,
        salePrice,
      );

      if (discountPercentage <= 0 || discountPercentage >= 90) {
        continue;
      }

      const sourceUrl = `https://${domain}/products/${handle}`;

      const genderText = [
        title,
        item.product_type,
        Array.isArray(item.tags) ? item.tags.join(" ") : item.tags,
        handle,
      ]
        .filter(Boolean)
        .join(" ");

      products.push({
        id: createHash("sha256")
          .update([sourceUrl, title, salePrice].join("|"))
          .digest("hex")
          .slice(0, 24),

        sourceName: domain,
        sourceUrl,

        market,
        currency: CURRENCY_BY_MARKET[market],
        gender: resolveGender(genderText, "UNISEX"),

        brandSlug: brand.slug,
        brandName: brand.englishName,

        productName: title,
        categorySlug: inferCategory(`${title} ${item.product_type ?? ""}`),

        imageUrl: item.images?.[0]?.src ?? "/product-placeholder.svg",

        originalPrice,
        salePrice,
        discountPercentage,
        saleVerification: "VERIFIED",

        isAvailable: true,
        collectedAt: new Date().toISOString(),
      });
    }

    if (items.length < 250) {
      break;
    }
  }

  return products;
}

/*
 * Collect from the shops brands run themselves. Smaller labels are
 * rarely discounted by the big platforms, so this is often the only
 * place their sales appear.
 */
export async function collectBrandStoreProducts(
  market: Market,
  brands: BrandRecord[] = getActiveBrands(),
): Promise<Product[]> {
  /*
   * A shop trades in one currency, so only visit the ones that belong
   * to the storefront being collected. Cafe24 is a Korean platform.
   */
  const withStores = brands.filter((brand) => {
    if (!brand.storeDomain || !brand.storePlatform) {
      return false;
    }

    const storeMarket =
      brand.storeMarket ??
      (brand.storePlatform === "cafe24" ? "KR" : null);

    return storeMarket === market;
  });

  if (withStores.length === 0) {
    return [];
  }

  const limit = pLimit(3);

  const results = await Promise.allSettled(
    withStores.map((brand) =>
      limit(() => {
        const domain = brand.storeDomain as string;

        return brand.storePlatform === "shopify"
          ? crawlShopifyStore(domain, brand, market)
          : crawlCafe24Store(domain, brand, market);
      }),
    ),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Brand store crawl failed:", result.reason);
    }
  }

  /*
   * A shop trades in one currency, so only return what belongs to the
   * market being collected.
   */
  return dedupeProducts(
    results
      .flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      )
      .filter((product) => product.market === market),
  );
}
