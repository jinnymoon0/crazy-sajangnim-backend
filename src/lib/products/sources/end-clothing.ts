import { createHash } from "node:crypto";

import { inferBrand } from "@/lib/products/infer-brand";
import { inferCategory } from "@/lib/products/infer-category";
import { calculateDiscountPercentage } from "@/lib/utils";
import type { Gender, Market, Product } from "@/types/product";

import { dedupeProducts, fetchWithTimeout, isReasonablePrice } from "./shared";

const ORIGIN = "https://www.endclothing.com";

/*
 * END. runs a storefront per country, each with its own prices carried
 * on the same product record: full_price_<storeId> against
 * final_price_<storeId>. The id is read from the page rather than
 * hard-coded, so a storefront renumbering shows up as no products
 * instead of prices from the wrong country.
 */
const REGIONS: Record<Market, string> = {
  US: "us",
  KR: "kr",
};

// Its sale sections are split by department, and the men's listing
// carries only a handful of the women's items.
const SALE_PATHS = ["sale/all-sale", "women/sale/all-sale"];

const MAX_PAGES_PER_PATH = 16;

interface EndHit {
  objectID?: string;
  sku?: string;
  name?: string;
  brand?: string;
  url_key?: string;
  small_image?: string;
  menswear?: number;
  womenswear?: number;
  stock?: number;
  department_hierarchy?: string[];
  [priceKey: string]: unknown;
}

interface EndPage {
  storeId: number;
  currency: string;
  mediaUrl: string;
  hits: EndHit[];
  pages: number;
}

function extractNextData(html: string): unknown {
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );

  if (!match?.[1]) {
    return null;
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

async function readPage(
  region: string,
  path: string,
  page: number,
): Promise<EndPage | null> {
  const url = `${ORIGIN}/${region}/${path}${page > 1 ? `?page=${page}` : ""}`;

  let html: string;

  try {
    const response = await fetchWithTimeout(url, {
      accept: "text/html,application/xhtml+xml",
      timeoutMs: 30_000,
    });

    if (!response.ok) {
      console.error(`END. ${url} returned ${response.status}`);

      return null;
    }

    html = await response.text();
  } catch (error) {
    console.error(`END. ${url} failed:`, error);

    return null;
  }

  const data = extractNextData(html) as
    | {
        props?: {
          initialState?: {
            config?: {
              country?: { store_id?: number; currency_code?: string };
              general?: { media_url?: string };
            };
          };
          initialProps?: {
            pageProps?: {
              initialAlgoliaState?: {
                results?: { hits?: EndHit[]; nbPages?: number };
              };
            };
          };
        };
      }
    | null;

  const config = data?.props?.initialState?.config;
  const results = data?.props?.initialProps?.pageProps?.initialAlgoliaState
    ?.results;

  const storeId = config?.country?.store_id;
  const currency = config?.country?.currency_code;
  const mediaUrl = config?.general?.media_url;

  if (typeof storeId !== "number" || !currency || !mediaUrl || !results?.hits) {
    console.error(`END. ${url}: the page no longer carries its catalogue.`);

    return null;
  }

  return {
    storeId,
    currency,
    mediaUrl,
    hits: results.hits,
    pages: results.nbPages ?? 1,
  };
}

function readPrice(hit: EndHit, key: string): number | null {
  const value = hit[key];

  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/*
 * END. tags each item as menswear, womenswear, or both, which is more
 * reliable than reading the title.
 */
function resolveEndGender(hit: EndHit): Gender {
  const men = hit.menswear === 1;
  const women = hit.womenswear === 1;

  if (men && women) {
    return "UNISEX";
  }

  if (women) {
    return "WOMEN";
  }

  return "MEN";
}

function normalizeHit(
  hit: EndHit,
  page: EndPage,
  region: string,
  market: Market,
): Product | null {
  const name = hit.name?.trim();
  const urlKey = hit.url_key?.trim();

  if (!name || !urlKey || (hit.stock ?? 0) <= 0) {
    return null;
  }

  /*
   * Match on END.'s own brand attribution rather than the title. Its
   * labels carry a department — "Nike Running", "Adidas Originals" —
   * which the matcher reduces to the brand.
   */
  const brand = inferBrand(hit.brand ?? "", { fromBrandField: true });

  if (!brand) {
    return null;
  }

  const originalPrice = readPrice(hit, `full_price_${page.storeId}`);
  const salePrice = readPrice(hit, `final_price_${page.storeId}`);

  if (
    !originalPrice ||
    !salePrice ||
    originalPrice <= salePrice ||
    !isReasonablePrice(salePrice, market)
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

  const sourceUrl = `${ORIGIN}/${region}/${urlKey}.html`;

  return {
    id: createHash("sha256")
      .update([sourceUrl, name, salePrice].join("|"))
      .digest("hex")
      .slice(0, 24),

    sourceName: "endclothing.com",
    sourceUrl,

    market,
    currency: market === "KR" ? "KRW" : "USD",
    gender: resolveEndGender(hit),

    brandSlug: brand.slug,
    brandName: brand.name,

    productName: name,
    categorySlug: inferCategory(
      [name, ...(hit.department_hierarchy ?? [])].join(" "),
    ),

    imageUrl: hit.small_image
      ? `${page.mediaUrl}catalog/product${hit.small_image}`
      : "/product-placeholder.svg",

    originalPrice,
    salePrice,
    discountPercentage,
    saleVerification: "VERIFIED",

    isAvailable: true,
    collectedAt: new Date().toISOString(),
  };
}

/*
 * Read END.'s sale sections. Its listings are rendered into the page
 * with the retailer's own brand, department and per-country prices, so
 * nothing has to be inferred from the title.
 */
export async function collectEndClothingProducts(
  market: Market,
): Promise<Product[]> {
  const region = REGIONS[market];
  const products: Product[] = [];

  for (const path of SALE_PATHS) {
    const first = await readPage(region, path, 1);

    if (!first) {
      continue;
    }

    /*
     * The storefront has to be pricing in the currency of the market
     * being collected, or the numbers would be right but the currency
     * wrong — the kind of mismatch that is invisible on the page.
     */
    const expected = market === "KR" ? "KRW" : "USD";

    if (first.currency !== expected) {
      console.error(
        `END. /${region} prices in ${first.currency}, expected ${expected}. Skipping.`,
      );

      continue;
    }

    const pages = Math.min(first.pages, MAX_PAGES_PER_PATH);

    if (first.pages > pages) {
      console.log(
        `END. /${region}/${path}: reading ${pages} of ${first.pages} pages.`,
      );
    }

    for (let page = 1; page <= pages; page += 1) {
      const current = page === 1 ? first : await readPage(region, path, page);

      if (!current) {
        break;
      }

      for (const hit of current.hits) {
        const product = normalizeHit(hit, current, region, market);

        if (product) {
          products.push(product);
        }
      }
    }
  }

  return dedupeProducts(products);
}
