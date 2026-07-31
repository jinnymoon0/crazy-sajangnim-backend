import { createHash } from "node:crypto";

import { inferBrand } from "@/lib/products/infer-brand";
import { inferCategory } from "@/lib/products/infer-category";
import { calculateDiscountPercentage } from "@/lib/utils";
import type { Product } from "@/types/product";

import type { RetailerAdapter, RetailerAdapterOptions } from "./types";

function absoluteUrl(
  value: string | undefined,
  pageUrl: string,
): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.startsWith("//") ? `https:${value}` : value;

  try {
    return new URL(normalized, pageUrl).toString();
  } catch {
    return null;
  }
}

function extractKrwPrices(text: string): number[] {
  const explicit = Array.from(
    text.matchAll(/(?:₩|KRW)?\s*([\d,]{4,})\s*(?:원)?/gi),
  )
    .map((match) => Number.parseInt(match[1].replace(/,/g, ""), 10))
    .filter(
      (value) =>
        Number.isFinite(value) && value >= 10_000 && value <= 20_000_000,
    );

  return Array.from(new Set(explicit)).sort((first, second) => first - second);
}

/*
 * Cafe24 shops link products either as a query string
 * (product/detail.html?product_no=123) or as a "pretty" path
 * (/product/champa-skirt/1067/category/29/display/1/), depending on the
 * shop's URL setting. Match both.
 */
const PRODUCT_LINK_SELECTOR =
  'a[href*="product/detail.html?product_no="], a[href^="/product/"]:not([href*="list.html"]):not([href*="search.html"])';

function resolveProductCards($: RetailerAdapterOptions["$"]) {
  const selectors = [
    ".xans-product-listnormal > ul > li",
    ".xans-product-listnormal li.xans-record-",
    ".xans-product-normalpackage li.xans-record-",
    ".prdList > li",
    ".product-list > li",
  ];

  for (const selector of selectors) {
    const cards = $(selector);

    if (cards.length > 0) {
      return cards;
    }
  }

  return $(PRODUCT_LINK_SELECTOR)
    .closest("li")
    .filter(
      (_, element) =>
        $(element).find(PRODUCT_LINK_SELECTOR).length >
        0,
    );
}

export const parseCafe24Products: RetailerAdapter = ({
  $,
  pageUrl,
  requestedGender,
  brandSlug,
  brandName,
  maxProducts,
  trustStoreBrand = false,
}): Product[] => {
  const products: Product[] = [];

  const cards = resolveProductCards($);

  cards.each((_, element) => {
    if (products.length >= maxProducts) {
      return false;
    }

    const card = $(element);

    const productAnchor = card
      .find(PRODUCT_LINK_SELECTOR)
      .first();

    const sourceUrl = absoluteUrl(productAnchor.attr("href"), pageUrl);

    if (!sourceUrl) {
      return;
    }

    const name = (
      card
        .find("p.name a, .name a, .description .name, .prdName, .name")
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim() ||
      productAnchor.find("img").first().attr("alt")?.trim() ||
      ""
    )
      // Some themes render the field label inside the name element.
      .replace(/^상품명\s*:\s*/, "")
      .trim();

    if (!name) {
      return;
    }

    /*
     * A boutique's search returns whatever it likes, including
     * unrelated products, so the brand has to come from the listing
     * itself. Only a shop that sells a single label can vouch for its
     * own products.
     */
    if (!trustStoreBrand) {
      const detectedBrand = inferBrand(name);

      if (!detectedBrand || detectedBrand.slug !== brandSlug) {
        return;
      }
    }

    /*
     * Restrict price parsing to the product card,
     * not the entire category page.
     */
    const cardText = card.text().replace(/\s+/g, " ").trim();

    const prices = extractKrwPrices(cardText);

    if (prices.length < 2) {
      return;
    }

    const salePrice = prices[0];

    const originalPrice = prices[prices.length - 1];

    if (originalPrice <= salePrice) {
      return;
    }

    const discountPercentage = calculateDiscountPercentage(
      originalPrice,
      salePrice,
    );

    if (discountPercentage <= 0 || discountPercentage >= 90) {
      return;
    }

    const imageElement = card
      .find("img.thumb-img, .thumbnail img, .prdImg img, img")
      .filter((_, image) => {
        const value =
          $(image).attr("data-original") ?? $(image).attr("src") ?? "";

        return Boolean(
          value && !value.includes("icon") && !value.includes("loading"),
        );
      })
      .first();

    const imageUrl =
      absoluteUrl(
        imageElement.attr("data-original") ?? imageElement.attr("src"),
        pageUrl,
      ) ?? "/product-placeholder.svg";

    let hostname = "Cafe24 retailer";

    try {
      hostname = new URL(pageUrl).hostname.replace(/^www\./, "");
    } catch {
      // Retain fallback.
    }

    const id = createHash("sha256")
      .update([sourceUrl, name, salePrice].join("|"))
      .digest("hex")
      .slice(0, 24);

    products.push({
      id,

      sourceName: hostname,
      sourceUrl,

      market: "KR",
      currency: "KRW",
      gender: requestedGender,

      brandSlug,
      brandName,

      productName: name,
      categorySlug: inferCategory(name),

      imageUrl,

      originalPrice,
      salePrice,
      discountPercentage,
      saleVerification: "VERIFIED",

      isAvailable: true,
      collectedAt: new Date().toISOString(),
    });
  });

  return Array.from(
    new Map(products.map((product) => [product.sourceUrl, product])).values(),
  );
};
