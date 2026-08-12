import { NextResponse } from "next/server";

import { getBrands } from "@/lib/products/brand-repository";
import {
  isAuthorizedService,
  unauthorizedResponse,
} from "@/lib/service-auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Gender, Market } from "@/types/product";
import { ALL_MARKETS } from "@/lib/products/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

const MARKETS: Market[] = ALL_MARKETS;
const SEGMENT_GENDERS: Exclude<Gender, "UNISEX">[] = ["MEN", "WOMEN"];

const PAGE_SIZE = 1000;

interface CatalogRow {
  market: Market;
  gender: Gender;
  source_name: string;
}

/*
 * Every sale item the brand has, read a page at a time. A response is
 * capped at a thousand rows however large a limit is asked for, so a
 * brand with more than that would otherwise be counted short.
 */
async function readBrandRows(slug: string): Promise<CatalogRow[]> {
  const supabase = getSupabaseAdmin();

  const rows: CatalogRow[] = [];

  for (let page = 0; ; page += 1) {
    const from = page * PAGE_SIZE;

    const { data, error } = await supabase
      .from("product_catalog")
      .select("market, gender, source_name")
      .eq("brand_slug", slug)
      .eq("is_available", true)
      .eq("sale_verification", "VERIFIED")
      .order("source_name")
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    rows.push(...((data ?? []) as unknown as CatalogRow[]));

    if (!data || data.length < PAGE_SIZE) {
      return rows;
    }
  }
}

/*
 * How a brand's sale items are spread across the shop: by storefront
 * and section, and by the site each item came from.
 */
export async function GET(request: Request, context: RouteContext) {
  if (!isAuthorizedService(request)) {
    return unauthorizedResponse();
  }

  try {
    const { slug } = await context.params;

    const brand = (await getBrands({ includeInactive: true })).find(
      (candidate) => candidate.slug === slug,
    );

    if (!brand) {
      return NextResponse.json(
        { error: "That brand is not tracked." },
        { status: 404 },
      );
    }

    const rows = await readBrandRows(slug);

    /*
     * Unisex items show in both sections of the shop, so they are
     * counted in both here too. That makes the section totals add up to
     * more than the item total, which is what the shop actually shows.
     */
    const segments = MARKETS.flatMap((market) =>
      SEGMENT_GENDERS.map((gender) => ({
        market,
        gender,
        count: rows.filter(
          (row) =>
            row.market === market &&
            (row.gender === gender || row.gender === "UNISEX"),
        ).length,
      })),
    );

    const sources = Object.fromEntries(
      MARKETS.map((market) => {
        const counts = new Map<string, number>();

        for (const row of rows) {
          if (row.market !== market) {
            continue;
          }

          const name = row.source_name || "unknown";

          counts.set(name, (counts.get(name) ?? 0) + 1);
        }

        return [
          market,
          Array.from(counts, ([sourceName, count]) => ({
            sourceName,
            count,
          })).sort((a, b) => b.count - a.count),
        ];
      }),
    ) as Record<Market, { sourceName: string; count: number }[]>;

    return NextResponse.json(
      {
        slug: brand.slug,
        englishName: brand.englishName,
        koreanName: brand.koreanName,
        storeDomain: brand.storeDomain ?? null,
        total: rows.length,
        totalByMarket: Object.fromEntries(
          MARKETS.map((market) => [
            market,
            rows.filter((row) => row.market === market).length,
          ]),
        ) as Record<Market, number>,
        segments,
        sources,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Brand breakdown failed:", error);

    return NextResponse.json(
      { error: "Could not read this brand's sale items." },
      { status: 500 },
    );
  }
}
