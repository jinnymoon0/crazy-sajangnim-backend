import { createHash } from "node:crypto";

import { readGender } from "@/lib/products/gender";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Gender, Market, Product, ProductSort } from "@/types/product";

const PRODUCT_TABLE = "product_catalog";

interface ProductCatalogRow {
  product_key: string;

  market: Market;
  currency: Product["currency"];
  gender: Gender;

  brand_slug: Product["brandSlug"];
  brand_name: string;

  product_name: string;
  category_slug: Product["categorySlug"];

  source_name: string;
  source_url: string;
  image_url: string;

  original_price: number | null;
  sale_price: number;
  discount_percentage: number | null;

  sale_verification: Product["saleVerification"];
  is_available: boolean;

  collected_at: string;
  first_seen_at?: string;
  last_seen_at: string;
}

export interface ProductCatalogQuery {
  market: Market;
  gender: Exclude<Gender, "UNISEX">;

  page: number;
  size: number;

  sort?: ProductSort;
  brandSlugs?: Product["brandSlug"][];
  categorySlug?: Product["categorySlug"] | null;
}

export interface ProductCatalogPage {
  products: Product[];

  page: number;
  size: number;
  total: number;
  hasMore: boolean;

  market: Market;
  gender: Exclude<Gender, "UNISEX">;

  updatedAt: string;
}

function createProductKey(product: Product): string {
  return createHash("sha256")
    .update(
      [
        product.market,
        product.gender,
        product.brandSlug,
        product.sourceUrl.trim(),
        product.productName.trim(),
      ].join("|"),
    )
    .digest("hex");
}

function productToRow(product: Product): ProductCatalogRow {
  const now = new Date().toISOString();

  return {
    product_key: createProductKey(product),

    market: product.market,
    currency: product.currency,
    gender: product.gender,

    brand_slug: product.brandSlug,
    brand_name: product.brandName,

    product_name: product.productName,
    category_slug: product.categorySlug,

    source_name: product.sourceName,
    source_url: product.sourceUrl,
    image_url: product.imageUrl,

    original_price: product.originalPrice,
    sale_price: product.salePrice,
    discount_percentage: product.discountPercentage,

    sale_verification: product.saleVerification,

    is_available: product.isAvailable,

    collected_at: product.collectedAt,
    last_seen_at: now,
  };
}

function rowToProduct(row: ProductCatalogRow): Product {
  return {
    id: row.product_key.slice(0, 24),

    sourceName: row.source_name,
    sourceUrl: row.source_url,

    market: row.market,
    currency: row.currency,
    gender: row.gender,

    brandSlug: row.brand_slug,
    brandName: row.brand_name,

    productName: row.product_name,
    categorySlug: row.category_slug,

    imageUrl: row.image_url,

    originalPrice:
      row.original_price === null ? null : Number(row.original_price),

    salePrice: Number(row.sale_price),

    discountPercentage:
      row.discount_percentage === null ? null : Number(row.discount_percentage),

    saleVerification: row.sale_verification,

    isAvailable: row.is_available,
    collectedAt: row.collected_at,

    /*
     * Sent to the browser so the shop can order by it and mark what is
     * new. collectedAt looks like it would do, but every refresh
     * rewrites it for every item in stock, so it says when we last
     * looked rather than when the item arrived.
     */
    firstSeenAt: row.first_seen_at ?? null,
  };
}

/*
 * The last word on gender, applied to every source alike.
 *
 * Each collector decides this for itself, and each of them can be wrong
 * in the same way: a crawl of a menswear page keeps its own default for
 * the womenswear on it. Fixing that inside one collector fixes it for
 * one collector, so the check lives here instead, where every source
 * without exception passes through on its way to the table.
 *
 * It only overrules a collector when the listing itself is unambiguous
 * — "women's", or a skirt. Everything else keeps whatever the source
 * believed, including UNISEX, which is a real answer for a t-shirt.
 */
function correctGender(product: Product): Product {
  const verdict = readGender(`${product.productName} ${product.categorySlug}`);

  if (!verdict || verdict.gender === product.gender) {
    return product;
  }

  console.log(
    `Gender corrected for "${product.productName}" from ${product.gender} ` +
      `to ${verdict.gender} (${verdict.reason}) — ${product.sourceName}`,
  );

  return { ...product, gender: verdict.gender };
}

export async function upsertProducts(products: Product[]): Promise<number> {
  if (products.length === 0) {
    return 0;
  }

  const supabase = getSupabaseAdmin();

  const uniqueRows = Array.from(
    new Map(
      products.map((product) => {
        /*
         * Corrected before the key is built, not after: product_key is a
         * hash of the gender among other things, so a row saved wrongly
         * and corrected later would be a second row rather than an
         * edit — the item would sit in both storefronts at once.
         */
        const row = productToRow(correctGender(product));

        return [row.product_key, row];
      }),
    ).values(),
  );

  const batchSize = 500;
  let savedCount = 0;

  for (let index = 0; index < uniqueRows.length; index += batchSize) {
    const batch = uniqueRows.slice(index, index + batchSize);

    const { error } = await supabase.from(PRODUCT_TABLE).upsert(batch, {
      onConflict: "product_key",
      ignoreDuplicates: false,
    });

    if (error) {
      throw new Error(`Unable to save product catalog: ${error.message}`);
    }

    savedCount += batch.length;
  }

  return savedCount;
}

export async function getProductsPage({
  market,
  gender,
  page,
  size,
  sort = "discount-desc",
  brandSlugs = [],
  categorySlug = null,
}: ProductCatalogQuery): Promise<ProductCatalogPage> {
  const supabase = getSupabaseAdmin();

  const safePage = Math.max(1, page);
  const safeSize = Math.min(300, Math.max(1, size));

  const start = (safePage - 1) * safeSize;

  const end = start + safeSize - 1;

  let query = supabase
    .from(PRODUCT_TABLE)
    .select(
      [
        "product_key",
        "market",
        "currency",
        "gender",
        "brand_slug",
        "brand_name",
        "product_name",
        "category_slug",
        "source_name",
        "source_url",
        "image_url",
        "original_price",
        "sale_price",
        "discount_percentage",
        "sale_verification",
        "is_available",
        "collected_at",
        "first_seen_at",
        "last_seen_at",
      ].join(","),
      {
        count: "exact",
      },
    )
    .eq("market", market)
    .in("gender", [gender, "UNISEX"])
    .eq("is_available", true)
    .eq("sale_verification", "VERIFIED");

  if (brandSlugs.length > 0) {
    query = query.in("brand_slug", brandSlugs);
  }

  if (categorySlug) {
    query = query.eq("category_slug", categorySlug);
  }

  switch (sort) {
    case "price-asc":
      query = query.order("sale_price", {
        ascending: true,
      });
      break;

    case "price-desc":
      query = query.order("sale_price", {
        ascending: false,
      });
      break;

    /*
     * When the item first appeared, not when it was last confirmed.
     *
     * This ordered by last_seen_at, which every collection rewrites for
     * every item still in stock — so an hour after a run, 994 of a
     * thousand US menswear items shared one timestamp and "Recently
     * added" was returning them in whatever order the database felt
     * like. first_seen_at is set once and never touched again, so it is
     * the only column that answers the question the sort is named for.
     *
     * Broken ties by id. Thousands of products enter in the same
     * collection and therefore share a first_seen_at to the
     * microsecond; without a stable second key the same item can appear
     * on two pages and another on none.
     */
    case "newest":
      query = query
        .order("first_seen_at", {
          ascending: false,
          nullsFirst: false,
        })
        .order("id", { ascending: true });
      break;

    case "discount-desc":
    default:
      query = query
        .order("discount_percentage", {
          ascending: false,
          nullsFirst: false,
        })
        .order("first_seen_at", {
          ascending: false,
          nullsFirst: false,
        })
        .order("id", { ascending: true });
      break;
  }

  const { data, error, count } = await query.range(start, end);

  if (error) {
    throw new Error(`Unable to read product catalog: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as ProductCatalogRow[];

  const total = count ?? 0;

  return {
    products: rows.map(rowToProduct),

    page: safePage,
    size: safeSize,
    total,
    hasMore: end + 1 < total,

    market,
    gender,

    updatedAt: new Date().toISOString(),
  };
}

export async function getCatalogCount(
  market: Market,
  gender: Exclude<Gender, "UNISEX">,
): Promise<number> {
  const supabase = getSupabaseAdmin();

  const { count, error } = await supabase
    .from(PRODUCT_TABLE)
    .select("product_key", {
      count: "exact",
      head: true,
    })
    .eq("market", market)
    .in("gender", [gender, "UNISEX"])
    .eq("is_available", true)
    .eq("sale_verification", "VERIFIED");

  if (error) {
    throw new Error(`Unable to count products: ${error.message}`);
  }

  return count ?? 0;
}
