import { NextResponse } from "next/server";

import {
  isAuthorizedService,
  unauthorizedResponse,
} from "@/lib/service-auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

/*
 * Stop tracking a brand. Products already collected keep their brand
 * label; only future collection passes skip it.
 */
export async function DELETE(request: Request, context: RouteContext) {
  if (!isAuthorizedService(request)) {
    return unauthorizedResponse();
  }

  try {
    const { slug } = await context.params;

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

    return NextResponse.json({ slug: data.slug, removed: true });
  } catch (error) {
    console.error("Brand delete error:", error);

    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}
