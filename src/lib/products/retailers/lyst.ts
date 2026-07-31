import { createHash } from "node:crypto";

import { inferBrand } from "@/lib/products/infer-brand";
import { inferCategory } from "@/lib/products/infer-category";
import { calculateDiscountPercentage } from "@/lib/utils";
import type { Product } from "@/types/product";

import type { RetailerAdapter, RetailerAdapterOptions } from "./types";

function parseUsdPrice(value: string): number | null {
  const match = value.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);

  if (!match) {
    return null;
  }

  const price = Number.parseFloat(match[1].replace(/,/g, ""));

  return Number.isFinite(price) && price >= 20 && price <= 50_000
    ? price
    : null;
}

function resolveImageUrl(
  card: import("cheerio").Cheerio<import("domhandler").Element>,
): string {
  const image = card.find('[data-testid="product-card-image"] img').first();

  const candidates = [
    image.attr("src"),
    image.attr("data-src"),
    image.attr("data-original"),
    image.attr("srcset")?.split(",").at(-1)?.trim().split(/\s+/)[0],
  ];

  const validImage = candidates.find(
    (candidate) => candidate && /^https?:\/\//i.test(candidate),
  );

  return validImage ?? "/product-placeholder.svg";
}

function getAbsoluteUrl(
  value: string | undefined,
  pageUrl: string,
): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, pageUrl).toString();
  } catch {
    return null;
  }
}

export const parseLystProducts: RetailerAdapter = ({
  $,
  pageUrl,
  requestedGender,
  brandSlug,
  brandName,
  maxProducts,
}: RetailerAdapterOptions): Product[] => {
  const products: Product[] = [];

  $('[data-testid="product-card"]').each((_, element) => {
    if (products.length >= maxProducts) {
      return false;
    }

    const card = $(element);

    /*
     * Only collect cards explicitly marked as
     * discounted by Lyst.
     */
    const saleContainer = card
      .find('[data-testid="product-price"] [data-testid="is-on-sale"]')
      .first();

    if (!saleContainer.length) {
      return;
    }

    const priceValues = saleContainer
      .text()
      .match(/\$\s*[\d,]+(?:\.\d{1,2})?/g)
      ?.map(parseUsdPrice)
      .filter((price): price is number => price !== null);

    if (!priceValues || priceValues.length < 2) {
      return;
    }

    const originalPrice = priceValues[0];

    const salePrice = priceValues[priceValues.length - 1];

    if (originalPrice <= salePrice) {
      return;
    }

    const brandText = card
      .find('[data-testid="product-card-short-description"]')
      .prev()
      .text()
      .trim();

    const description = card
      .find('[data-testid="product-card-short-description"]')
      .first()
      .text()
      .trim();

    const imageAlt = card
      .find('[data-testid="product-card-image"] img')
      .first()
      .attr("alt")
      ?.trim();

    const productName =
      [brandText, description].filter(Boolean).join(" ").trim() ||
      imageAlt ||
      "";

    if (!productName) {
      return;
    }

    const detectedBrand = inferBrand(productName);

    if (!detectedBrand || detectedBrand.slug !== brandSlug) {
      return;
    }

    /*
     * Keep the exact offer URL tied to the price
     * displayed on the Lyst product card.
     */
    const offerHref = card
      .find('a[data-testid="product-card-lead-link"]')
      .first()
      .attr("href");

    const productHref = card.find('a[href^="/clothing/"]').first().attr("href");

    const sourceUrl = getAbsoluteUrl(offerHref ?? productHref, pageUrl);

    if (!sourceUrl) {
      return;
    }

    const imageUrl = resolveImageUrl(card);

    const discountPercentage = calculateDiscountPercentage(
      originalPrice,
      salePrice,
    );

    if (discountPercentage <= 0 || discountPercentage >= 100) {
      return;
    }

    const retailerName =
      card
        .find('[data-testid="retailer-name"]')
        .text()
        .replace(/^From\s+/i, "")
        .trim() || "Lyst";

    const id = createHash("sha256")
      .update([sourceUrl, productName, salePrice].join("|"))
      .digest("hex")
      .slice(0, 24);

    products.push({
      id,

      sourceName: `lyst.com · ${retailerName}`,
      sourceUrl,

      market: "US",
      currency: "USD",
      gender: requestedGender,

      brandSlug,
      brandName: detectedBrand.name || brandName,

      productName,
      categorySlug: inferCategory(productName),

      imageUrl,

      originalPrice,
      salePrice,
      discountPercentage,
      /*
       * Lyst prices are discovery snapshots. The destination
       * retailer may show a different regional or current price.
       */
      saleVerification: "UNVERIFIED",

      isAvailable: true,
      collectedAt: new Date().toISOString(),
    });
  });

  return Array.from(
    new Map(products.map((product) => [product.sourceUrl, product])).values(),
  );
};
