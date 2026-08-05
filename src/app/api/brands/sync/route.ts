import { NextResponse } from "next/server";

import {
  findBrandDrift,
  purgeOrphanedProducts,
} from "@/lib/products/brand-sync";
import {
  isAuthorizedService,
  unauthorizedResponse,
} from "@/lib/service-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Reading the whole catalog a page at a time takes longer than a
 * request usually does, and the alternative is not knowing whether the
 * two halves agree.
 */
export const maxDuration = 120;

/*
 * Where the catalog and the brand list disagree.
 *
 * Read-only: it reports, it does not repair. Products can be filed
 * under an untracked brand because the brand was deliberately removed
 * or because a rename is half-done, and those want opposite responses.
 */
export async function GET(request: Request) {
  if (!isAuthorizedService(request)) {
    return unauthorizedResponse();
  }

  try {
    const drift = await findBrandDrift();

    return NextResponse.json(
      {
        ...drift,
        inSync: drift.orphaned.length === 0,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Brand drift check failed:", error);

    return NextResponse.json(
      { error: "Could not compare the catalog with the brand list." },
      { status: 500 },
    );
  }
}

/*
 * Repair it, by removing products filed under brands that are not
 * tracked. Takes the slugs to remove rather than acting on everything
 * it finds, so a half-finished rename cannot be swept away by a caller
 * that has not looked first.
 */
export async function POST(request: Request) {
  if (!isAuthorizedService(request)) {
    return unauthorizedResponse();
  }

  try {
    const body = (await request.json().catch(() => null)) as {
      slugs?: unknown;
    } | null;

    const slugs = Array.isArray(body?.slugs)
      ? body.slugs.filter(
          (slug): slug is string =>
            typeof slug === "string" && /^[a-z0-9-]{1,60}$/.test(slug),
        )
      : [];

    if (slugs.length === 0) {
      return NextResponse.json(
        {
          error:
            "Pass the slugs to clear, e.g. { \"slugs\": [\"on\"] }. Ask GET first to see which are adrift.",
        },
        { status: 400 },
      );
    }

    const drift = await findBrandDrift();
    const adrift = new Set(drift.orphaned.map((entry) => entry.slug));

    /* Never touch a brand that is tracked — that would delete live stock. */
    const refused = slugs.filter((slug) => !adrift.has(slug));

    if (refused.length > 0) {
      return NextResponse.json(
        {
          error: `These are tracked brands, not drift: ${refused.join(", ")}`,
        },
        { status: 409 },
      );
    }

    const removed = await purgeOrphanedProducts(slugs);

    return NextResponse.json({ removed });
  } catch (error) {
    console.error("Brand drift repair failed:", error);

    return NextResponse.json(
      { error: "Could not clear the products." },
      { status: 500 },
    );
  }
}
