import { createHash } from "node:crypto";
import pLimit from "p-limit";

import { inferBrand } from "@/lib/products/infer-brand";
import { inferCategory } from "@/lib/products/infer-category";
import { getActiveBrands } from "@/lib/products/brand-registry";
import type { BrandRecord } from "@/lib/products/brand-repository";
import { calculateDiscountPercentage } from "@/lib/utils";
import type { Product } from "@/types/product";

import {
  dedupeProducts,
  fetchWithTimeout,
  isReasonablePrice,
  resolveGender,
} from "./shared";

const SEARCH_URL = "https://search-api.29cm.co.kr/api/v4/products/search";
const IMAGE_BASE = "https://img.29cm.co.kr";
const PAGE_SIZE = 40;
const MAX_PAGES_PER_TERM = 2;

interface TwentyNineCmItem {
  itemNo?: number;
  itemName?: string;
  frontBrandNameKor?: string;
  frontBrandNameEng?: string;
  consumerPrice?: number;
  imageUrl?: string;
  isSoldOut?: boolean;
  saleInfoV2?: {
    consumerPrice?: number;
    sellPrice?: number;
    saleRate?: number;
  };
}

interface TwentyNineCmResponse {
  data?: {
    products?: TwentyNineCmItem[];
  };
}

/*
 * Like Musinsa, the search matches product titles, so unrelated sellers
 * surface when a designer name appears in the title. The brand fields
 * are the store's own attribution, so identify from those.
 */
function normalizeItem(
  item: TwentyNineCmItem,
  brand: BrandRecord,
): Product | null {
  const name = item.itemName?.trim();

  if (!name || !item.itemNo || item.isSoldOut) {
    return null;
  }

  const brandLabel = [item.frontBrandNameEng, item.frontBrandNameKor]
    .filter(Boolean)
    .join(" ");

  const detected = inferBrand(brandLabel, { fromBrandField: true });

  if (!detected || detected.slug !== brand.slug) {
    return null;
  }

  const originalPrice =
    item.saleInfoV2?.consumerPrice ?? item.consumerPrice ?? 0;

  /*
   * sellPrice is what the product page charges. lastSalePrice includes
   * coupons that not every shopper can claim, so it would show a price
   * the retailer does not actually display.
   */
  const salePrice = item.saleInfoV2?.sellPrice ?? 0;

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

  const imagePath = item.imageUrl ?? "";

  return {
    id: createHash("sha256")
      .update([item.itemNo, name, salePrice].join("|"))
      .digest("hex")
      .slice(0, 24),

    sourceName: "29cm.co.kr",
    sourceUrl: `https://product.29cm.co.kr/catalog/${item.itemNo}`,

    market: "KR",
    currency: "KRW",
    gender: resolveGender(name, "UNISEX"),

    brandSlug: detected.slug,
    brandName: detected.name,

    productName: name,
    categorySlug: inferCategory(name),

    imageUrl: imagePath
      ? `${IMAGE_BASE}${imagePath.startsWith("/") ? "" : "/"}${imagePath}`
      : "/product-placeholder.svg",

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

  const terms = Array.from(
    new Set(
      [brand.koreanName, brand.englishName, ...brand.aliases].filter(
        (value): value is string => Boolean(value && value.trim()),
      ),
    ),
  ).slice(0, 3);

  for (const term of terms) {
    for (let page = 1; page <= MAX_PAGES_PER_TERM; page += 1) {
      let body: TwentyNineCmResponse;

      try {
        const response = await fetchWithTimeout(
          `${SEARCH_URL}?keyword=${encodeURIComponent(term)}&page=${page}&size=${PAGE_SIZE}`,
        );

        if (!response.ok) {
          break;
        }

        body = (await response.json()) as TwentyNineCmResponse;
      } catch {
        break;
      }

      const items = body.data?.products ?? [];

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

export async function collectTwentyNineCmProducts(
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
