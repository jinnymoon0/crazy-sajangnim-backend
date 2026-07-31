import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
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

const BASE_URL = "https://www.okmall.com";
const MAX_PAGES_PER_BRAND = 3;

function parseKrwAmount(text: string): number | null {
  const match = text.replace(/\s+/g, " ").match(/([\d,]{4,})/);

  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1].replace(/,/g, ""), 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function absoluteUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return null;
  }
}

function parseListPage(html: string): Product[] {
  const $ = cheerio.load(html);
  const products: Product[] = [];

  $(".item_box").each((_, element) => {
    const card = $(element);

    const title = card
      .find(".item_title")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();

    if (!title) {
      return;
    }

    const detectedBrand = inferBrand(title);

    if (!detectedBrand) {
      return;
    }

    /*
     * OK Mall lists a struck-through original price (.orgin_price) next to
     * the selling price. Use .okmall_price — the price the product page
     * itself displays. .sale_price is a coupon/membership price that does
     * not match the page, which read as a price error to visitors.
     */
    const originalPrice = parseKrwAmount(
      card.find(".orgin_price").first().text(),
    );

    const salePrice =
      parseKrwAmount(card.find(".okmall_price").first().text()) ??
      parseKrwAmount(card.find(".sale_price").first().text());

    if (
      !originalPrice ||
      !salePrice ||
      originalPrice <= salePrice ||
      !isReasonablePrice(salePrice, "KR")
    ) {
      return;
    }

    const discountPercentage = calculateDiscountPercentage(
      originalPrice,
      salePrice,
    );

    if (discountPercentage <= 0 || discountPercentage >= 90) {
      return;
    }

    const href = card.find("a[href]").first().attr("href");
    const sourceUrl = absoluteUrl(href);

    if (!sourceUrl) {
      return;
    }

    const image = card.find(".item_img img, img").first();

    const imageUrl =
      absoluteUrl(image.attr("data-original") ?? image.attr("src")) ??
      "/product-placeholder.svg";

    products.push({
      id: createHash("sha256")
        .update([sourceUrl, title, salePrice].join("|"))
        .digest("hex")
        .slice(0, 24),

      sourceName: "okmall.com",
      sourceUrl,

      market: "KR",
      currency: "KRW",
      gender: resolveGender(card.text(), "UNISEX"),

      brandSlug: detectedBrand.slug,
      brandName: detectedBrand.name,

      productName: title,
      categorySlug: inferCategory(title),

      imageUrl,

      originalPrice,
      salePrice,
      discountPercentage,
      saleVerification: "VERIFIED",

      isAvailable: true,
      collectedAt: new Date().toISOString(),
    });
  });

  return products;
}

async function crawlBrand(englishName: string): Promise<Product[]> {
  const products: Product[] = [];
  let previousFirstUrl: string | null = null;

  for (let page = 1; page <= MAX_PAGES_PER_BRAND; page += 1) {
    let html: string;

    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/products/list?search_word=${encodeURIComponent(
          englishName,
        )}&page=${page}`,
        {
          accept: "text/html,application/xhtml+xml",
          timeoutMs: 20_000,
        },
      );

      if (!response.ok) {
        break;
      }

      html = await response.text();
    } catch {
      break;
    }

    const pageProducts = parseListPage(html);

    if (pageProducts.length === 0) {
      break;
    }

    /*
     * Some list endpoints ignore the page parameter and repeat page one;
     * stop as soon as pagination stops advancing.
     */
    if (pageProducts[0].sourceUrl === previousFirstUrl) {
      break;
    }

    previousFirstUrl = pageProducts[0].sourceUrl;
    products.push(...pageProducts);
  }

  return products;
}

export async function collectOkmallProducts(): Promise<Product[]> {
  const limit = pLimit(2);

  const results = await Promise.allSettled(
    getActiveBrands().map((brand) => limit(() => crawlBrand(brand.englishName))),
  );

  return dedupeProducts(
    results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    ),
  );
}
