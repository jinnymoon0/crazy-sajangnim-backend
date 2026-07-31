import { NextResponse } from "next/server";

import { getBrands } from "@/lib/products/brand-repository";
import { setActiveBrands } from "@/lib/products/brand-registry";
import { upsertProducts } from "@/lib/products/product-repository";
import { collectDirectProducts } from "@/lib/products/sources";
import {
  isAuthorizedService,
  unauthorizedResponse,
} from "@/lib/service-auth";
import type { Market } from "@/types/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

const MARKETS: Market[] = ["US", "KR"];

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

    const perMarket: Record<string, number> = {};

    let saved = 0;

    for (const market of MARKETS) {
      const products = await collectDirectProducts(market, [brand]);

      const forBrand = products.filter(
        (product) => product.brandSlug === brand.slug,
      );

      perMarket[market] = forBrand.length;

      if (forBrand.length > 0) {
        saved += await upsertProducts(forBrand);
      }
    }

    return NextResponse.json({
      slug: brand.slug,
      englishName: brand.englishName,
      collected: perMarket,
      saved,
    });
  } catch (error) {
    console.error("Brand collection error:", error);

    return NextResponse.json(
      { error: "The collection run could not be completed." },
      { status: 500 },
    );
  }
}
