import { NextRequest, NextResponse } from "next/server";

import {
  findBrandCandidates,
  isLatinName,
} from "@/lib/products/brand-lookup";
import { toBrandSlug } from "@/lib/products/brand-repository";
import {
  isAuthorizedService,
  unauthorizedResponse,
} from "@/lib/service-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * Resolve a brand written in any language to the English names
 * retailers use. The admin picks one of the candidates and posts it to
 * /api/brands.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedService(request)) {
    return unauthorizedResponse();
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (!query) {
    return NextResponse.json(
      { error: "Please provide a brand name to search for." },
      { status: 400 },
    );
  }

  const alreadyLatin = isLatinName(query);

  try {
    const candidates = await findBrandCandidates(query);

    return NextResponse.json(
      {
        query,
        alreadyLatin,
        candidates: candidates.map((candidate) => ({
          ...candidate,
          slug: toBrandSlug(candidate.englishName),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Brand search error:", error);

    return NextResponse.json(
      { error: "The brand search could not be completed." },
      { status: 502 },
    );
  }
}
