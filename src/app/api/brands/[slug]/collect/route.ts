import { NextResponse } from "next/server";

import {
  getBrands,
  type BrandRecord,
} from "@/lib/products/brand-repository";
import { setActiveBrands } from "@/lib/products/brand-registry";
import { discoverBrandStore } from "@/lib/products/brand-store-discovery";
import { upsertProducts } from "@/lib/products/product-repository";
import { collectDirectProducts } from "@/lib/products/sources";
import {
  isAuthorizedService,
  unauthorizedResponse,
} from "@/lib/service-auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Market } from "@/types/product";
import { ALL_MARKETS } from "@/lib/products/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

/*
 * Every storefront, so adding a brand in the admin collects its
 * Japanese stock too. Hand-written this was ["US", "KR"], which stayed
 * a valid Market[] after Japan was added — the compiler had nothing to
 * object to and a new brand would simply never have appeared in Japan.
 */
const MARKETS: Market[] = ALL_MARKETS;

/*
 * Find the brand's own shop and remember it, so later runs go straight
 * there. A brand without one still collects from the retailers.
 */
async function attachDiscoveredStore(
  brand: BrandRecord,
): Promise<BrandRecord> {
  let store = null;

  try {
    store = await discoverBrandStore(brand.englishName, brand.slug);
  } catch (error) {
    console.error("Brand store discovery failed:", error);
  }

  if (!store) {
    return brand;
  }

  try {
    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from("brands")
      .update({
        store_domain: store.domain,
        store_platform: store.platform,
        store_market: store.market,
      })
      .eq("slug", brand.slug);

    if (error) {
      console.error("Could not save the discovered store:", error.message);
    }
  } catch (error) {
    console.error("Could not save the discovered store:", error);
  }

  return {
    ...brand,
    storeDomain: store.domain,
    storePlatform: store.platform,
    storeMarket: store.market,
  };
}

/*
 * Collect sale items for one brand across both markets. Adding a brand
 * in the admin calls this so its products appear straight away instead
 * of waiting for the nightly refresh.
 */
export async function POST(request: Request, context: RouteContext) {
  if (!isAuthorizedService(request)) {
    return unauthorizedResponse();
  }

  try {
    const { slug } = await context.params;

    const brands = await getBrands();

    const brand = brands.find((candidate) => candidate.slug === slug);

    if (!brand) {
      return NextResponse.json(
        { error: "That brand is not tracked." },
        { status: 404 },
      );
    }

    /*
     * Brand matching inside HTML parsing reads the registry, so keep
     * every tracked brand installed — narrowing that would make
     * listings from other brands unrecognisable. Only the per-brand
     * retailer queries are scoped, which is where the time goes.
     */
    setActiveBrands(brands);

    /*
     * Brands added before store discovery existed have no shop on file,
     * so look for one here too. That way re-collecting an empty brand
     * picks up its own store rather than repeating the same search.
     */
    const withStore = brand.storeDomain
      ? brand
      : await attachDiscoveredStore(brand);

    const perMarket: Record<string, number> = {};

    let saved = 0;

    for (const market of MARKETS) {
      const products = await collectDirectProducts(market, [withStore]);

      const forBrand = products.filter(
        (product) => product.brandSlug === brand.slug,
      );

      perMarket[market] = forBrand.length;

      if (forBrand.length > 0) {
        saved += await upsertProducts(forBrand);
      }
    }

    /*
     * A brand only earns a place in the shop by having something on
     * sale, whether at its own store or at the retailers. Callers
     * adding one ask for this so an empty brand does not leave a filter
     * behind that shows nothing.
     */
    const total = MARKETS.reduce(
      (sum, market) => sum + (perMarket[market] ?? 0),
      0,
    );

    const dropIfEmpty =
      new URL(request.url).searchParams.get("dropIfEmpty") === "true";

    let removed = false;

    if (total === 0 && dropIfEmpty) {
      const { error } = await getSupabaseAdmin()
        .from("brands")
        .delete()
        .eq("slug", brand.slug);

      if (error) {
        console.error("Could not drop the empty brand:", error.message);
      } else {
        removed = true;
      }
    }

    return NextResponse.json({
      slug: brand.slug,
      englishName: brand.englishName,
      storeDomain: withStore.storeDomain ?? null,
      collected: perMarket,
      saved,
      removed,
    });
  } catch (error) {
    console.error("Brand collection error:", error);

    return NextResponse.json(
      { error: "The collection run could not be completed." },
      { status: 500 },
    );
  }
}
