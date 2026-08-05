import { createHash } from "node:crypto";
import pLimit from "p-limit";

import { inferBrand } from "@/lib/products/infer-brand";
import { inferCategory } from "@/lib/products/infer-category";
import { getActiveBrands } from "@/lib/products/brand-registry";
import type { BrandRecord } from "@/lib/products/brand-repository";
import { calculateDiscountPercentage } from "@/lib/utils";
import type { Gender, Product } from "@/types/product";

import {
  dedupeProducts,
  fetchWithTimeout,
  isReasonablePrice,
} from "./shared";

const SEARCH_URL = "https://api.musinsa.com/api2/dp/v1/plp/goods";
const PAGE_SIZE = 60;
const MAX_PAGES_PER_TERM = 2;

interface MusinsaItem {
  goodsNo?: number;
  goodsName?: string;
  goodsLinkUrl?: string;
  thumbnail?: string;
  isSoldOut?: boolean;
  normalPrice?: number;
  price?: number;
  saleRate?: number;
  brand?: string;
  brandName?: string;
  displayGenderText?: string;
}

interface MusinsaResponse {
  data?: {
    list?: MusinsaItem[];
  };
}

function resolveGenderFromMusinsa(item: MusinsaItem): Gender {
  const value = item.displayGenderText ?? "";

  if (value.includes("여성")) {
    return "WOMEN";
  }

  if (value.includes("남성")) {
    return "MEN";
  }

  return "UNISEX";
}

/*
 * Musinsa's keyword search returns anything whose title mentions the
 * term, including resellers who put a designer name in the title of an
 * unrelated product. Identify the brand from the seller's brand field
 * instead, which is the store's own attribution.
 */
function normalizeItem(
  item: MusinsaItem,
  brand: BrandRecord,
): Product | null {
  const name = item.goodsName?.trim();
  const link = item.goodsLinkUrl?.trim();

  if (!name || !link || item.isSoldOut) {
    return null;
  }

  const brandLabel = [item.brandName, item.brand]
    .filter(Boolean)
    .join(" ");

  const detected = inferBrand(brandLabel, { fromBrandField: true });

  if (!detected || detected.slug !== brand.slug) {
    return null;
  }

  const originalPrice = item.normalPrice ?? 0;
  const salePrice = item.price ?? 0;

  if (
    !isReasonablePrice(salePrice, "KR") ||
    originalPrice <= salePrice
  ) {
    return null;
  }

  const discountPercentage = calculateDiscountPercentage(
    originalPrice,
    salePrice,
  );

  if (discountPercentage <= 0 || discountPercentage >= 95) {
    return null;
  }

  return {
    id: createHash("sha256")
      .update([link, name, salePrice].join("|"))
      .digest("hex")
      .slice(0, 24),

    sourceName: "musinsa.com",
    sourceUrl: link,

    market: "KR",
    currency: "KRW",
    gender: resolveGenderFromMusinsa(item),

    brandSlug: detected.slug,
    brandName: detected.name,

    productName: name,
    categorySlug: inferCategory(name),

    imageUrl: item.thumbnail ?? "/product-placeholder.svg",

    originalPrice,
    salePrice,
    discountPercentage,
    saleVerification: "VERIFIED",

    isAvailable: true,
    collectedAt: new Date().toISOString(),
  };
}

async function crawlBrand(brand: BrandRecord): Promise<Product[]> {
  const products: Product[] = [];

  /*
   * Korean shoppers search by the Korean spelling, so query the
   * aliases rather than only the English name.
   */
  const terms = Array.from(
    new Set(
      [brand.koreanName, brand.englishName, ...brand.aliases].filter(
        (value): value is string => Boolean(value && value.trim()),
      ),
    ),
  ).slice(0, 3);

  for (const term of terms) {
    for (let page = 1; page <= MAX_PAGES_PER_TERM; page += 1) {
      let body: MusinsaResponse;

      try {
        const response = await fetchWithTimeout(
          `${SEARCH_URL}?keyword=${encodeURIComponent(term)}&gf=A&page=${page}&size=${PAGE_SIZE}&caller=SEARCH`,
        );

        if (!response.ok) {
          break;
        }

        body = (await response.json()) as MusinsaResponse;
      } catch {
        break;
      }

      const items = body.data?.list ?? [];

      if (items.length === 0) {
        break;
      }

      for (const item of items) {
        const product = normalizeItem(item, brand);

        if (product) {
          products.push(product);
        }
      }

      if (items.length < PAGE_SIZE) {
        break;
      }
    }
  }

  return products;
}

export async function collectMusinsaProducts(
  brands: BrandRecord[] = getActiveBrands(),
): Promise<Product[]> {
  const limit = pLimit(3);

  const results = await Promise.allSettled(
    brands.map((brand) => limit(() => crawlBrand(brand))),
  );

  return dedupeProducts(
    results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    ),
  );
}
