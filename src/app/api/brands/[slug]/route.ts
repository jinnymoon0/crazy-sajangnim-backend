import { NextResponse } from "next/server";

import {
  isAuthorizedService,
  unauthorizedResponse,
} from "@/lib/service-auth";
import { purgeOrphanedProducts } from "@/lib/products/brand-sync";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

/*
 * Stop tracking a brand, and take its products with it.
 *
 * They used to be left behind. The shop builds its brand filters from
 * the catalog rather than from this table, so those products went on
 * being offered under a brand that could no longer be looked up — which
 * is how slip-ons stayed filed under ON long after ON was removed.
 *
 * Pass ?keepProducts=true to leave them, for a rename where the rows
 * are about to be re-filed under the new slug.
 */
export async function DELETE(request: Request, context: RouteContext) {
  if (!isAuthorizedService(request)) {
    return unauthorizedResponse();
  }

  try {
    const { slug } = await context.params;

    const keepProducts =
      new URL(request.url).searchParams.get("keepProducts") === "true";

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("brands")
      .delete()
      .eq("slug", slug)
      .select("slug")
      .maybeSingle();

    if (error) {
      console.error("Brand delete failed:", {
        code: error.code,
        message: error.message,
      });

      return NextResponse.json(
        { error: "Failed to remove the brand." },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "That brand is not tracked." },
        { status: 404 },
      );
    }

    /*
     * The brand row is gone either way; failing to clear the catalog
     * leaves drift rather than undoing the removal, so it is reported
     * rather than turned into a 500.
     */
    let productsRemoved: number | null = 0;

    if (!keepProducts) {
      try {
        const [result] = await purgeOrphanedProducts([slug]);

        productsRemoved = result?.removed ?? 0;
      } catch (purgeError) {
        console.error("Brand removed but its products remain:", purgeError);

        productsRemoved = null;
      }
    } else {
      productsRemoved = null;
    }

    return NextResponse.json({
      slug: data.slug,
      removed: true,
      productsRemoved,
    });
  } catch (error) {
    console.error("Brand delete error:", error);

    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}
