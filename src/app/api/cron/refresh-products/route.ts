import { NextRequest, NextResponse } from "next/server";

import type { Market } from "@/types/product";

import {
  backfillMissingStores,
  type BackfillResult,
} from "@/lib/products/store-backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RefreshResult {
  market: Market;
  gender: "MEN" | "WOMEN";
  ok: boolean;
  status: number;
  count?: number;
  savedCount?: number;
  error?: string;
  /** Which storeless brand was re-probed this run, and what turned up. */
  backfill?: BackfillResult;
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        error: "Unauthorized",
      },
      {
        status: 401,
      },
    );
  }

  const marketValue = request.nextUrl.searchParams.get("market");

  const genderValue = request.nextUrl.searchParams.get("gender");

  /*
   * A closed list rather than a cast. An unrecognised value used to
   * fall through to US, so a typo in the schedule quietly refreshed the
   * wrong storefront and reported success.
   */
  const market: Market =
    marketValue === "KR" ? "KR" : marketValue === "JP" ? "JP" : "US";

  const gender = genderValue === "WOMEN" ? "WOMEN" : "MEN";

  const refreshUrl = new URL("/api/products", request.nextUrl.origin);

  refreshUrl.searchParams.set("market", market);

  refreshUrl.searchParams.set("gender", gender);

  refreshUrl.searchParams.set("debug", "true");

  /*
   * The retailer collectors only. The search-engine phase depends on a
   * SearXNG instance that a deployed copy of this service cannot reach,
   * and it spent the whole time budget retrying it — so the collectors
   * that do work never got their turn and the catalogue went stale.
   */
  refreshUrl.searchParams.set("mode", "direct");

  try {
    /*
     * The collection endpoint is behind the service token, so this call
     * has to carry it. It did not when the service was split out, and
     * every nightly refresh since has been turned away with a 401 —
     * silently, because the cron reported the failure to a log nobody
     * reads while the catalogue quietly went stale.
     */
    const serviceToken = process.env.BACKEND_API_TOKEN?.trim();

    if (!serviceToken) {
      console.error(
        "BACKEND_API_TOKEN is not set, so the refresh cannot authenticate.",
      );

      return NextResponse.json(
        { market, gender, ok: false, error: "Refresh is not configured." },
        { status: 500 },
      );
    }

    const response = await fetch(refreshUrl, {
      cache: "no-store",
      headers: {
        "User-Agent": "crazy-sajangnim-catalog-refresh/1.0",
        Authorization: `Bearer ${serviceToken}`,
      },
    });

    const body = (await response.json()) as {
      count?: number;
      error?: string;
      diagnostics?: {
        savedCount?: number;
        persistenceError?: string | null;
      };
    };

    /*
     * After the collection, never instead of it. Store discovery only
     * runs when a brand is added, and a failure there is logged rather
     * than retried — so a brand added during any outage keeps no shop
     * for ever. One brand is re-probed per run, chosen by the clock, so
     * the twenty-odd without a shop each come round about once a day.
     *
     * Its own try/catch because it must not turn a successful refresh
     * into a failed one. A backfill that could fail the collection
     * would be a worse bug than the one it fixes.
     */
    let backfill: BackfillResult | undefined;

    try {
      backfill = await backfillMissingStores(
        new Date().getUTCHours(),
      );
    } catch (error) {
      console.error("Store backfill failed:", error);
    }

    const result: RefreshResult = {
      market,
      gender,
      ok: response.ok,
      status: response.status,
      count: body.count,
      savedCount: body.diagnostics?.savedCount,
      error: body.error ?? body.diagnostics?.persistenceError ?? undefined,
      backfill,
    };

    return NextResponse.json(result, {
      status: response.ok ? 200 : response.status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        market,
        gender,
        ok: false,
        status: 500,
        error:
          error instanceof Error ? error.message : "Catalog refresh failed.",
      } satisfies RefreshResult,
      {
        status: 500,
      },
    );
  }
}
