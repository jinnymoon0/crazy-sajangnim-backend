import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { BrandSlug } from "@/constants/brands";
import type { Product } from "@/types/product";
import { calculateDiscountPercentage } from "@/lib/utils";
import { inferCategory } from "@/lib/products/infer-category";
import { inferGender } from "@/lib/products/infer-gender";
import { inferBrand } from "@/lib/products/infer-brand";

interface ParseOptions {
  retailerName: string;
  url: string;
  fallbackTitle: string;
  fallbackThumbnail?: string;

  brandSlug: BrandSlug;
  brandName: string;
  gender: "MEN" | "WOMEN";
}

interface JsonLdProduct {
  "@type"?: string | string[];
  name?: string;

  brand?:
    | string
    | {
        name?: string;
      };

  image?: string | string[];
  sku?: string;
  productID?: string;
  url?: string;

  offers?:
    | JsonLdOffer
    | JsonLdOffer[];

  priceSpecification?:
    | JsonLdPriceSpecification
    | JsonLdPriceSpecification[];
}

interface JsonLdOffer {
  price?: string | number;
  lowPrice?: string | number;
  highPrice?: string | number;
  url?: string;
  availability?: string;

  priceSpecification?:
    | JsonLdPriceSpecification
    | JsonLdPriceSpecification[];
}

interface JsonLdPriceSpecification {
  price?: string | number;
  priceType?: string;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .replace(/,/g, "")
    .replace(/[^\d.]/g, "");

  const parsed = Number.parseFloat(normalized);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function flattenJsonLd(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap(flattenJsonLd);
  }

  if (!value || typeof value !== "object") {
    return [value];
  }

  const object = value as Record<string, unknown>;

  if (Array.isArray(object["@graph"])) {
    return object["@graph"].flatMap(flattenJsonLd);
  }

  return [value];
}

function getJsonLdProducts($: cheerio.CheerioAPI): JsonLdProduct[] {
  const products: JsonLdProduct[] = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const text = $(element).text().trim();

    if (!text) {
      return;
    }

    try {
      const parsed = JSON.parse(text);

      for (const item of flattenJsonLd(parsed)) {
        if (!item || typeof item !== "object") {
          continue;
        }

        const candidate = item as JsonLdProduct;
        const types = Array.isArray(candidate["@type"])
          ? candidate["@type"]
          : [candidate["@type"]];

        if (types.includes("Product")) {
          products.push(candidate);
        }
      }
    } catch {
      // Ignore malformed retailer JSON-LD.
    }
  });

  return products;
}

function collectPriceSpecifications(
  value:
    | JsonLdPriceSpecification
    | JsonLdPriceSpecification[]
    | undefined,
): JsonLdPriceSpecification[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function resolvePrices(product: JsonLdProduct): {
  originalPrice: number;
  salePrice: number;
} | null {
  const offers = Array.isArray(product.offers)
    ? product.offers
    : product.offers
      ? [product.offers]
      : [];

  const activePrices: number[] = [];
  const oldPrices: number[] = [];

  for (const offer of offers) {
    for (const value of [
      offer.price,
      offer.lowPrice,
      offer.highPrice,
    ]) {
      const price = parseNumber(value);

      if (price) {
        activePrices.push(price);
      }
    }

    const specifications = [
      ...collectPriceSpecifications(offer.priceSpecification),
      ...collectPriceSpecifications(product.priceSpecification),
    ];

    for (const specification of specifications) {
      const price = parseNumber(specification.price);

      if (!price) {
        continue;
      }

      const type = specification.priceType?.toLowerCase() ?? "";

      if (
        type.includes("strikethrough") ||
        type.includes("listprice") ||
        type.includes("regular")
      ) {
        oldPrices.push(price);
      } else {
        activePrices.push(price);
      }
    }
  }

  const uniqueActivePrices = [...new Set(activePrices)].sort(
    (first, second) => first - second,
  );

  const salePrice = uniqueActivePrices[0];

  if (!salePrice) {
    return null;
  }

  const possibleOldPrices = [
    ...oldPrices,
    ...uniqueActivePrices.filter((price) => price > salePrice),
  ].filter((price) => price > salePrice);

  const originalPrice = Math.max(...possibleOldPrices, 0);

  if (!originalPrice || originalPrice <= salePrice) {
    return null;
  }

  return {
    originalPrice,
    salePrice,
  };
}

function absoluteUrl(
  value: string | undefined,
  baseUrl: string,
): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

export async function parseRetailerProductPage({
  retailerName,
  url,
  fallbackTitle,
  fallbackThumbnail,
  brandSlug,
  gender,
}: ParseOptions): Promise<Product | null> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
      "User-Agent":
        process.env.COLLECTOR_USER_AGENT ??
        "Mozilla/5.0 CrazySajangnim/1.0",
    },
    signal: AbortSignal.timeout(12_000),
    next: {
      revalidate: 21_600,
    },
  });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const jsonLdProducts = getJsonLdProducts($);

  for (const jsonProduct of jsonLdProducts) {
    const prices = resolvePrices(jsonProduct);

    if (!prices) {
      continue;
    }

    const title =
      jsonProduct.name?.trim() ||
      $('meta[property="og:title"]').attr("content")?.trim() ||
      fallbackTitle;

    const jsonLdBrand =
      typeof jsonProduct.brand === "string"
        ? jsonProduct.brand
        : jsonProduct.brand?.name;

    const detectedBrand = inferBrand(
      [
        jsonLdBrand,
        title,
        fallbackTitle,
      ]
        .filter(
          (value): value is string =>
            Boolean(value),
        )
        .join(" "),
    );

    /*
     * Reject products whose actual brand does not match the brand whose
     * retailer search produced this candidate.
     */
    if (
      !detectedBrand ||
      detectedBrand.slug !== brandSlug
    ) {
      continue;
    }

    const rawImage = Array.isArray(jsonProduct.image)
      ? jsonProduct.image[0]
      : jsonProduct.image;

    const imageUrl =
      absoluteUrl(rawImage, url) ??
      absoluteUrl(
        $('meta[property="og:image"]').attr("content"),
        url,
      ) ??
      fallbackThumbnail;

    if (!title || !imageUrl) {
      continue;
    }

    const discountPercentage = calculateDiscountPercentage(
      prices.originalPrice,
      prices.salePrice,
    );

    if (discountPercentage <= 0) {
      continue;
    }

    const sourceUrl =
      absoluteUrl(jsonProduct.url, url) ??
      absoluteUrl(
        Array.isArray(jsonProduct.offers)
          ? jsonProduct.offers[0]?.url
          : jsonProduct.offers?.url,
        url,
      ) ??
      url;

    return {
      id:
        jsonProduct.sku ??
        jsonProduct.productID ??
        createHash("sha256")
          .update(`${retailerName}|${sourceUrl}`)
          .digest("hex")
          .slice(0, 24),

      sourceName: retailerName,
      sourceUrl,

      market: "KR",
      currency: "KRW",
      gender: inferGender(title, gender),

      brandSlug: detectedBrand.slug,
      brandName: detectedBrand.name,

      productName: title,
      categorySlug: inferCategory(title),

      imageUrl,

      originalPrice: prices.originalPrice,
      salePrice: prices.salePrice,
      discountPercentage,
      saleVerification: "VERIFIED",

      isAvailable: true,
      collectedAt: new Date().toISOString(),
    };
  }

  return null;
}
