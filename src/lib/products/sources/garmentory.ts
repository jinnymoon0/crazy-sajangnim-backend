import { createHash } from "node:crypto";
import pLimit from "p-limit";

import { BRANDS } from "@/constants/brands";
import { inferBrand } from "@/lib/products/infer-brand";
import { inferCategory } from "@/lib/products/infer-category";
import { calculateDiscountPercentage } from "@/lib/utils";
import type { Product } from "@/types/product";

import {
  dedupeProducts,
  fetchWithTimeout,
  isReasonablePrice,
  parseUsdAmount,
  resolveGender,
} from "./shared";

const MAX_PAGES_PER_BRAND = 6;

interface GarmentoryItem {
  id?: string | number;
  active?: boolean;
  name?: string;
  path?: string;
  brand?: string;
  retailPrice?: string;
  price?: string;
  isDiscounted?: boolean;
  hasVaryingPrices?: boolean;
  store?: string;
  mainImage?: {
    largeUrl?: string;
  };
}

interface GarmentoryResponse {
  resultsData?: {
    products?: GarmentoryItem[];
  };
  paginationData?: {
    totalPages?: number;
    hasNextPage?: boolean;
  };
}

function normalizeItem(item: GarmentoryItem): Product | null {
  const name = item.name?.trim();
  const path = item.path?.trim();

  if (!name || !path || item.active === false || !item.isDiscounted) {
    return null;
  }

  /*
   * When the price differs per size, the listing price does not match what
   * the product page shows for every option — skip to avoid apparent
   * price errors.
   */
  if (item.hasVaryingPrices) {
    return null;
  }

  const detectedBrand = inferBrand(`${item.brand ?? ""} ${name}`);

  if (!detectedBrand) {
    return null;
  }

  const salePrice = parseUsdAmount(item.price);
  const originalPrice = parseUsdAmount(item.retailPrice);

  if (
    !salePrice ||
    !originalPrice ||
    originalPrice <= salePrice ||
    !isReasonablePrice(salePrice, "US")
  ) {
    return null;
  }

  const discountPercentage = calculateDiscountPercentage(
    originalPrice,
    salePrice,
  );

  if (discountPercentage <= 0 || discountPercentage >= 90) {
    return null;
  }

  const sourceUrl = `https://www.garmentory.com${path}`;

  return {
    id: createHash("sha256")
      .update([sourceUrl, name, salePrice].join("|"))
      .digest("hex")
      .slice(0, 24),

    sourceName: item.store?.trim()
      ? `garmentory.com · ${item.store.trim()}`
      : "garmentory.com",
    sourceUrl,

    market: "US",
    currency: "USD",

    /*
     * Garmentory paths encode gender, e.g.
     * /sale/lemaire/mens-slip-on/... or /sale/lemaire/womens-dresses/...
     */
    gender: resolveGender(`${path} ${name}`, "UNISEX"),

    brandSlug: detectedBrand.slug,
    brandName: detectedBrand.name,

    productName: name,
    categorySlug: inferCategory(`${name} ${path}`),

    imageUrl: item.mainImage?.largeUrl ?? "/product-placeholder.svg",

    originalPrice,
    salePrice,
    discountPercentage,
    saleVerification: "VERIFIED",

    isAvailable: true,
    collectedAt: new Date().toISOString(),
  };
}

async function crawlBrand(englishName: string): Promise<Product[]> {
  const products: Product[] = [];

  /*
   * The /sale/<brand> feed is brand-exact and sale-biased, unlike the fuzzy
   * /search?q= endpoint that mixes in other designers.
   */
  const permalink = englishName.toLowerCase().replace(/\s+/g, "-");

  let previousFirstId: GarmentoryItem["id"] | null = null;

  for (let page = 1; page <= MAX_PAGES_PER_BRAND; page += 1) {
    let body: GarmentoryResponse;

    try {
      const response = await fetchWithTimeout(
        `https://www.garmentory.com/sale/${permalink}?page=${page}`,
      );

      if (!response.ok) {
        break;
      }

      body = (await response.json()) as GarmentoryResponse;
    } catch {
      break;
    }

    const items = body.resultsData?.products ?? [];

    if (items.length === 0) {
      break;
    }

    /*
     * Pages beyond the last one repeat their content instead of coming back
     * empty; stop once pagination stops advancing.
     */
    if (items[0]?.id !== undefined && items[0].id === previousFirstId) {
      break;
    }

    previousFirstId = items[0]?.id ?? null;

    for (const item of items) {
      const product = normalizeItem(item);

      if (product) {
        products.push(product);
      }
    }

    if (body.paginationData?.hasNextPage === false) {
      break;
    }
  }

  return products;
}

export async function collectGarmentoryProducts(): Promise<Product[]> {
  const limit = pLimit(3);

  const results = await Promise.allSettled(
    BRANDS.map((brand) => limit(() => crawlBrand(brand.englishName))),
  );

  return dedupeProducts(
    results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    ),
  );
}
