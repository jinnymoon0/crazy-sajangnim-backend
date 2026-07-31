import { NextResponse } from "next/server";

import { apiDocsEnabled } from "@/lib/api-docs";
import spec from "@/openapi/spec.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!apiDocsEnabled()) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.json(spec, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
