import { createHash } from "node:crypto";
import pLimit from "p-limit";

import { getActiveBrands } from "@/lib/products/brand-registry";
import { inferBrand } from "@/lib/products/infer-brand";
import { inferCategory } from "@/lib/products/infer-category";
import { calculateDiscountPercentage } from "@/lib/utils";
import type { Product } from "@/types/product";

import {
  dedupeProducts,
  fetchWithTimeout,
  isReasonablePrice,
  resolveGender,
} from "./shared";

const MAX_PAGES_PER_BRAND = 3;

interface HbxItem {
  id?: number | string;
  code?: string;
  name?: string;
  brands?: Array<{
    name?: string;
    code?: string;
  }>;
  [key: string]: unknown;
}

interface HbxResponse {
  pagination?: {
    items?: HbxItem[];
    pages?: number;
    page?: number;
  };
}

interface PriceCandidate {
  key: string;
  value: number;
}

/*
 * HBX search items carry price fields whose exact names are not part of a
 * stable public contract. Collect every numeric field whose key mentions a
 * price, then require an explicit original/list style key above the lowest
 * price before treating the listing as a verified sale.
 */
function collectPriceCandidates(
  value: unknown,
  keyPath: string,
  bucket: PriceCandidate[],
): void {
  if (bucket.length > 24) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPriceCandidates(entry, keyPath, bucket);
    }

    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectPriceCandidates(child, `${keyPath}.${key}`.toLowerCase(), bucket);
    }

    return;
  }

  if (!/price|msrp/.test(keyPath)) {
    return;
  }

  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value.replace(/[^0-9.]/g, ""))
        : Number.NaN;

  if (Number.isFinite(numeric) && numeric > 0) {
    bucket.push({ key: keyPath, value: numeric });
  }
}

function resolveHbxPrices(item: HbxItem): {
  salePrice: number;
  originalPrice: number;
} | null {
  const candidates: PriceCandidate[] = [];

  collectPriceCandidates(item, "", candidates);

  if (candidates.length === 0) {
    return null;
  }

  const originalCandidates = candidates.filter((candidate) =>
    /original|regular|list|retail|compare|was|msrp|strike/.test(candidate.key),
  );

  const saleCandidates = candidates.filter(
    (candidate) => !originalCandidates.includes(candidate),
  );

  if (originalCandidates.length === 0 || saleCandidates.length === 0) {
    return null;
  }

  const salePrice = Math.min(
    ...saleCandidates.map((candidate) => candidate.value),
  );

  const originalPrice = Math.max(
    ...originalCandidates.map((candidate) => candidate.value),
  );

  if (originalPrice <= salePrice) {
    return null;
  }

  return { salePrice, originalPrice };
}

function normalizeItem(item: HbxItem): Product | null {
  const name = item.name?.trim();
  const code = typeof item.code === "string" ? item.code.trim() : "";

  if (!name || !code) {
    return null;
  }

  const brandNames = (item.brands ?? [])
    .map((brand) => brand.name ?? brand.code ?? "")
    .join(" ");

  const detectedBrand = inferBrand(`${brandNames} ${name}`);

  if (!detectedBrand) {
    return null;
  }

  const prices = resolveHbxPrices(item);

  if (!prices || !isReasonablePrice(prices.salePrice, "US")) {
    return null;
  }

  const discountPercentage = calculateDiscountPercentage(
    prices.originalPrice,
    prices.salePrice,
  );

  if (discountPercentage <= 0 || discountPercentage >= 90) {
    return null;
  }

  const sourceUrl = `https://hbx.com/products/${code}`;

  const genderText = JSON.stringify(item.brands ?? "").includes("/women")
    ? "women"
    : JSON.stringify(item).includes("/women/")
      ? "women"
      : JSON.stringify(item).includes("/men/")
        ? "men"
        : "";

  return {
    id: createHash("sha256")
      .update([sourceUrl, name, prices.salePrice].join("|"))
      .digest("hex")
      .slice(0, 24),

    sourceName: "hbx.com",
    sourceUrl,

    market: "US",
    currency: "USD",
    gender: resolveGender(`${genderText} ${name}`, "UNISEX"),

    brandSlug: detectedBrand.slug,
    brandName: detectedBrand.name,

    productName: name,
    categorySlug: inferCategory(name),

    imageUrl: "/product-placeholder.svg",

    originalPrice: prices.originalPrice,
    salePrice: prices.salePrice,
    discountPercentage,
    saleVerification: "VERIFIED",

    isAvailable: true,
    collectedAt: new Date().toISOString(),
  };
}

async function crawlBrand(englishName: string): Promise<Product[]> {
  const products: Product[] = [];

  for (let page = 1; page <= MAX_PAGES_PER_BRAND; page += 1) {
    let body: HbxResponse;

    try {
      const response = await fetchWithTimeout(
        `https://hbx.com/search?q=${encodeURIComponent(
          englishName.toLowerCase(),
        )}&page=${page}`,
      );

      if (!response.ok) {
        break;
      }

      body = (await response.json()) as HbxResponse;
    } catch {
      break;
    }

    const items = body.pagination?.items ?? [];

    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      const product = normalizeItem(item);

      if (product) {
        products.push(product);
      }
    }

    const { page: currentPage, pages } = body.pagination ?? {};

    if (currentPage !== undefined && pages !== undefined && currentPage >= pages) {
      break;
    }
  }

  return products;
}

export async function collectHbxProducts(): Promise<Product[]> {
  const limit = pLimit(3);

  const results = await Promise.allSettled(
    getActiveBrands().map((brand) => limit(() => crawlBrand(brand.englishName))),
  );

  return dedupeProducts(
    results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    ),
  );
}
