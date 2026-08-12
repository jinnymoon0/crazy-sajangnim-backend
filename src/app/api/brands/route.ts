import { NextRequest, NextResponse } from "next/server";
import pLimit from "p-limit";
import { z } from "zod";

import {
  expandAliases,
  getBrands,
  seedBrands,
  toBrandSlug,
} from "@/lib/products/brand-repository";
import { isLatinName } from "@/lib/products/brand-lookup";
import {
  discoverBrandStore,
  type DiscoveredStore,
} from "@/lib/products/brand-store-discovery";
import { discoverRetailers } from "@/lib/products/retailer-discovery";
import { rememberRetailers } from "@/lib/products/retailer-repository";
import { searchProviderName } from "@/lib/search/web-search";
import {
  isAuthorizedService,
  unauthorizedResponse,
} from "@/lib/service-auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Market } from "@/types/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Adding a brand probes the domains it might trade under, then the
 * shops search suggests stock it — each of which has to answer for
 * itself before it is kept. That is slower than a request usually is,
 * and the alternative is adding a brand the collectors cannot yet read.
 */
export const maxDuration = 300;

const createBrandSchema = z.object({
  englishName: z
    .string()
    .trim()
    .min(1, "Please enter the brand's English name.")
    .max(80, "The brand name must be 80 characters or fewer."),

  koreanName: z.string().trim().max(80).nullish(),

  aliases: z.array(z.string().trim().min(1).max(80)).max(20).optional(),

  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,60}$/)
    .optional(),

  addedBy: z.string().trim().max(120).nullish(),
});

export async function GET(request: NextRequest) {
  if (!isAuthorizedService(request)) {
    return unauthorizedResponse();
  }

  const includeInactive =
    request.nextUrl.searchParams.get("includeInactive") === "true";

  const withCounts =
    request.nextUrl.searchParams.get("withCounts") === "true";

  const brands = await getBrands({ includeInactive });

  if (!withCounts) {
    return NextResponse.json(
      { brands, count: brands.length },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  /*
   * Ask the database to count each brand rather than reading the
   * catalog and counting here. A response is capped at a thousand rows
   * however large a limit is asked for, so counting rows we fetched
   * undercounted every brand past that cap — and since rows come back
   * oldest first, the brands that read as empty were exactly the ones
   * added most recently.
   *
   * Counted per storefront, because one total hides which shop a
   * brand's items are in: Stussy's were all American, so the Korean
   * store showed none of the 31 the total promised.
   */
  const counts = new Map<string, Record<Market, number> | null>();

  const limit = pLimit(6);

  async function countIn(slug: string, market: Market): Promise<number> {
    const { count, error } = await getSupabaseAdmin()
      .from("product_catalog")
      .select("id", { count: "exact", head: true })
      .eq("brand_slug", slug)
      .eq("market", market)
      .eq("is_available", true)
      .eq("sale_verification", "VERIFIED");

    if (error) {
      throw new Error(error.message);
    }

    return count ?? 0;
  }

  await Promise.all(
    brands.map((brand) =>
      limit(async () => {
        try {
          const [US, KR, JP] = await Promise.all([
            countIn(brand.slug, "US"),
            countIn(brand.slug, "KR"),
            countIn(brand.slug, "JP"),
          ]);

          counts.set(brand.slug, { US, KR, JP });
        } catch (error) {
          console.error(`Count failed for ${brand.slug}:`, error);

          /*
           * Null, not zero. A brand whose count could not be read has
           * not been shown to have nothing on sale.
           */
          counts.set(brand.slug, null);
        }
      }),
    ),
  );

  return NextResponse.json(
    {
      brands: brands.map((brand) => {
        const byMarket = counts.get(brand.slug) ?? null;

        return {
          ...brand,
          productCount: byMarket ? byMarket.US + byMarket.KR : null,
          productCountByMarket: byMarket,
        };
      }),
      count: brands.length,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isAuthorizedService(request)) {
    return unauthorizedResponse();
  }

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = createBrandSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message ?? "Please check the brand.",
        },
        { status: 400 },
      );
    }

    const englishName = parsed.data.englishName.toUpperCase();

    /*
     * Collectors query retailers in English, so a name that is not
     * written in Latin script cannot be searched for directly. The
     * admin resolves it first through /api/brands/search.
     */
    if (!isLatinName(englishName)) {
      return NextResponse.json(
        {
          error:
            "The English name is required. Search for the brand first to find how retailers spell it.",
        },
        { status: 400 },
      );
    }

    const slug = parsed.data.slug ?? toBrandSlug(englishName);

    if (!slug) {
      return NextResponse.json(
        { error: "Could not derive a slug from that brand name." },
        { status: 400 },
      );
    }

    const koreanName = parsed.data.koreanName?.trim() || null;

    /*
     * Match the punctuation variants retailers actually use, not only
     * the name exactly as it was typed.
     */
    const aliases = Array.from(
      new Set(
        [
          ...expandAliases(englishName),
          ...(parsed.data.aliases ?? []).flatMap((alias) =>
            expandAliases(alias),
          ),
          koreanName,
        ]
          .filter((value): value is string => Boolean(value && value.trim()))
          .map((value) => value.trim()),
      ),
    );

    /*
     * The shipped brands are only a fallback while the table is empty,
     * so copy them in before the first addition. Otherwise adding one
     * brand would leave it as the only tracked brand.
     */
    try {
      await seedBrands();
    } catch (error) {
      console.error("Brand seeding failed:", error);
    }

    /*
     * Small labels are rarely discounted by the big platforms, so their
     * own shop is usually the only place their sales show up. Look for
     * it now so the collection that follows can read it.
     */
    let store: DiscoveredStore | null = null;

    try {
      store = await discoverBrandStore(englishName, slug);
    } catch (error) {
      console.error("Brand store discovery failed:", error);
    }

    /*
     * Then the shops that stock it. Search proposes; each candidate has
     * to show the brand in its own catalogue before it is kept, so a
     * listicle or a resale site never becomes a source.
     *
     * With no search provider configured this finds nothing and the
     * brand is added exactly as before — this is an improvement on the
     * collectors, not something they wait on.
     */
    let stockists = 0;

    try {
      const found = await discoverRetailers(englishName, koreanName);

      stockists = await rememberRetailers(found, slug);
    } catch (error) {
      console.error("Stockist discovery failed:", error);
    }

    const supabase = getSupabaseAdmin();

    const row = {
      slug,
      english_name: englishName,
      korean_name: koreanName,
      aliases,
      is_active: true,
      added_by: parsed.data.addedBy?.trim() || null,
    };

    let { data, error } = await supabase
      .from("brands")
      .insert({
        ...row,
        store_domain: store?.domain ?? null,
        store_platform: store?.platform ?? null,
        store_market: store?.market ?? null,
      })
      .select("slug, english_name, korean_name, aliases, is_active")
      .single();

    /*
     * The store columns are optional; without them the brand is still
     * worth tracking, it just cannot be collected from its own shop.
     */
    if (error?.code === "PGRST204" || error?.code === "42703") {
      console.error(
        "Brand store columns are missing. Run supabase/brand-stores.sql.",
      );

      ({ data, error } = await supabase
        .from("brands")
        .insert(row)
        .select("slug, english_name, korean_name, aliases, is_active")
        .single());
    }

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "That brand is already tracked." },
          { status: 409 },
        );
      }

      if (error.code === "42P01" || error.code === "PGRST205") {
        return NextResponse.json(
          {
            error:
              "The brands table does not exist yet. Run supabase/brands.sql.",
          },
          { status: 503 },
        );
      }

      console.error("Brand insert failed:", {
        code: error.code,
        message: error.message,
      });

      return NextResponse.json(
        { error: "Failed to add the brand." },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Failed to add the brand." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        brand: {
          slug: data.slug,
          englishName: data.english_name,
          koreanName: data.korean_name,
          aliases: data.aliases ?? [],
          isActive: data.is_active,
          store,
          stockistsFound: stockists,
          searchProvider: searchProviderName(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Brand create error:", error);

    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}
