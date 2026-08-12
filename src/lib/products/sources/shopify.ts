import { createHash } from "node:crypto";
import pLimit from "p-limit";

import { inferBrand } from "@/lib/products/infer-brand";
import { inferCategory } from "@/lib/products/infer-category";
import { calculateDiscountPercentage } from "@/lib/utils";
import type { Gender, Market, Product } from "@/types/product";

import {
  dedupeProducts,
  fetchWithTimeout,
  isReasonablePrice,
  resolveGender,
} from "./shared";
import { getRetailers } from "@/lib/products/retailer-repository";

interface ShopifyStore {
  domain: string;
  defaultGender: Gender;
}

/*
 * The stockists this list used to hold now live in the retailers table,
 * so a shop found while adding a brand is read from the next run
 * onwards without a redeploy. Kept here only as the fallback the
 * repository falls back to.
 */
const SHOPIFY_STORES: ShopifyStore[] = [
  { domain: "svrn.com", defaultGender: "UNISEX" },
  { domain: "mohawkgeneralstore.com", defaultGender: "UNISEX" },
  { domain: "notre-shop.com", defaultGender: "UNISEX" },
  { domain: "standardandstrange.com", defaultGender: "MEN" },
  { domain: "blueowl.us", defaultGender: "MEN" },
  { domain: "unionlosangeles.com", defaultGender: "MEN" },
  { domain: "stagprovisions.com", defaultGender: "MEN" },
  { domain: "snakeoilprovisions.com", defaultGender: "MEN" },
  { domain: "featuresneakerboutique.com", defaultGender: "MEN" },
];

const MAX_PAGES_PER_STORE = 24;
const PAGE_SIZE = 250;

interface ShopifyVariant {
  price?: string;
  compare_at_price?: string | null;
  available?: boolean;
}

interface ShopifyImage {
  src?: string;
}

interface ShopifyProduct {
  title?: string;
  handle?: string;
  vendor?: string;
  product_type?: string;
  tags?: string[] | string;
  variants?: ShopifyVariant[];
  images?: ShopifyImage[];
}

/*
 * Shopify Markets stores geo-localize /products.json prices by requester IP.
 * USD (and other decimal currencies) arrive as "245.00" while zero-decimal
 * currencies such as KRW arrive as integer strings like "299100". Accept only
 * decimal-formatted prices so a crawl from a non-US location cannot save
 * foreign-currency amounts labeled as USD.
 */
function parsePrice(value: string | null | undefined): number | null {
  if (!value || !/^\d+\.\d{1,2}$/.test(value.trim())) {
    return null;
  }

  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toTagText(tags: ShopifyProduct["tags"]): string {
  if (Array.isArray(tags)) {
    return tags.join(" ");
  }

  return tags ?? "";
}

function normalizeShopifyProduct(
  raw: ShopifyProduct,
  store: ShopifyStore,
): Product | null {
  const title = raw.title?.trim();
  const handle = raw.handle?.trim();

  if (!title || !handle) {
    return null;
  }

  const brandText = [raw.vendor, title, raw.product_type]
    .filter(Boolean)
    .join(" ");

  /*
   * The shop's own attribution first: when it names the brand, that is
   * the shop saying so, and a name that is also an ordinary word is
   * believed. Falling back to the text lets a title name a brand the
   * field missed — but never a word like ON, which is why a Vans slip-on was
   * filed under it.
   */
  const detectedBrand =
    (raw.vendor ? inferBrand(raw.vendor, { fromBrandField: true }) : null) ??
    inferBrand(brandText);

  if (!detectedBrand) {
    return null;
  }

  /*
   * A product is on sale only when the retailer itself publishes a
   * higher compare-at price for an in-stock variant.
   */
  const saleVariants = (raw.variants ?? []).filter((variant) => {
    if (variant.available === false) {
      return false;
    }

    const price = parsePrice(variant.price);
    const compareAt = parsePrice(variant.compare_at_price ?? null);

    return price !== null && compareAt !== null && compareAt > price;
  });

  if (saleVariants.length === 0) {
    return null;
  }

  const cheapest = saleVariants.reduce((best, variant) =>
    (parsePrice(variant.price) ?? Infinity) <
    (parsePrice(best.price) ?? Infinity)
      ? variant
      : best,
  );

  const salePrice = parsePrice(cheapest.price);
  const originalPrice = parsePrice(cheapest.compare_at_price ?? null);

  if (
    !salePrice ||
    !originalPrice ||
    !isReasonablePrice(salePrice, "US") ||
    originalPrice <= salePrice
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

  const sourceUrl = `https://${store.domain}/products/${handle}`;

  const genderText = [title, raw.product_type, toTagText(raw.tags), handle]
    .filter(Boolean)
    .join(" ");

  return {
    id: createHash("sha256")
      .update([sourceUrl, title, salePrice].join("|"))
      .digest("hex")
      .slice(0, 24),

    sourceName: store.domain,
    sourceUrl,

    market: "US",
    currency: "USD",
    gender: resolveGender(genderText, store.defaultGender),

    brandSlug: detectedBrand.slug,
    brandName: detectedBrand.name,

    productName: title,
    categorySlug: inferCategory(`${title} ${raw.product_type ?? ""}`),

    imageUrl: raw.images?.[0]?.src ?? "/product-placeholder.svg",

    originalPrice,
    salePrice,
    discountPercentage,
    saleVerification: "VERIFIED",

    isAvailable: true,
    collectedAt: new Date().toISOString(),
  };
}

async function crawlStore(store: ShopifyStore): Promise<Product[]> {
  const products: Product[] = [];

  for (let page = 1; page <= MAX_PAGES_PER_STORE; page += 1) {
    let items: ShopifyProduct[];

    try {
      const response = await fetchWithTimeout(
        `https://${store.domain}/products.json?limit=${PAGE_SIZE}&page=${page}`,
      );

      if (!response.ok) {
        console.warn(
          `Shopify crawl stopped: ${store.domain} page ${page} returned ${response.status}`,
        );

        break;
      }

      const body = (await response.json()) as {
        products?: ShopifyProduct[];
      };

      items = body.products ?? [];
    } catch (error) {
      console.warn(
        `Shopify crawl stopped: ${store.domain} page ${page} failed:`,
        error instanceof Error ? error.message : error,
      );

      break;
    }

    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      /*
       * One malformed listing must not discard the rest of the
       * store's harvest.
       */
      try {
        const product = normalizeShopifyProduct(item, store);

        if (product) {
          products.push(product);
        }
      } catch (error) {
        console.warn(
          `Shopify listing skipped on ${store.domain}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    if (items.length < PAGE_SIZE) {
      break;
    }
  }

  return products;
}

export async function collectShopifyProducts(
  market: Market = "US",
): Promise<Product[]> {
  const limit = pLimit(4);

  const stored = await getRetailers("shopify");

  /*
   * Only the shops that price in the storefront's own money. A shop is
   * recorded with the currency it banks in, and reading a Japanese
   * shop's yen as dollars would put a ¥30,000 coat in the American
   * storefront at $30,000.
   *
   * This used to be pinned to "US", so asking for any other storefront
   * quietly collected the American shops and stamped their products
   * with the storefront that had been asked for — the first Japanese
   * run wrote 858 American products into Japan's place.
   */
  const stores: ShopifyStore[] = stored
    .filter((retailer) => retailer.market === market)
    .map((retailer) => ({
      domain: retailer.domain,
      defaultGender: retailer.defaultGender,
    }));

  /*
   * The built-in list is American, so it is only a fallback for that
   * storefront. Another market with no shops on file collects nothing,
   * which is the honest answer — not a page of the wrong country's
   * stock.
   */
  const fallback = market === "US" ? SHOPIFY_STORES : [];

  const results = await Promise.allSettled(
    (stores.length > 0 ? stores : fallback).map((store) =>
      limit(() => crawlStore(store)),
    ),
  );

  return dedupeProducts(
    results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    ),
  );
}
