import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getBrands,
  toBrandSlug,
} from "@/lib/products/brand-repository";
import { isLatinName } from "@/lib/products/brand-lookup";
import {
  isAuthorizedService,
  unauthorizedResponse,
} from "@/lib/service-auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const brands = await getBrands({ includeInactive });

  return NextResponse.json(
    { brands, count: brands.length },
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

    const aliases = Array.from(
      new Set(
        [englishName, ...(parsed.data.aliases ?? []), koreanName]
          .filter((value): value is string => Boolean(value && value.trim()))
          .map((value) => value.trim()),
      ),
    );

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("brands")
      .insert({
        slug,
        english_name: englishName,
        korean_name: koreanName,
        aliases,
        is_active: true,
        added_by: parsed.data.addedBy?.trim() || null,
      })
      .select("slug, english_name, korean_name, aliases, is_active")
      .single();

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

    return NextResponse.json(
      {
        brand: {
          slug: data.slug,
          englishName: data.english_name,
          koreanName: data.korean_name,
          aliases: data.aliases ?? [],
          isActive: data.is_active,
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
