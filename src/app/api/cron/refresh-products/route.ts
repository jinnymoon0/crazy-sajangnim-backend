import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RefreshResult {
  market: "US" | "KR";
  gender: "MEN" | "WOMEN";
  ok: boolean;
  status: number;
  count?: number;
  savedCount?: number;
  error?: string;
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

  const market = marketValue === "KR" ? "KR" : "US";

  const gender = genderValue === "WOMEN" ? "WOMEN" : "MEN";

  const refreshUrl = new URL("/api/products", request.nextUrl.origin);

  refreshUrl.searchParams.set("market", market);

  refreshUrl.searchParams.set("gender", gender);

  refreshUrl.searchParams.set("debug", "true");

  try {
    const response = await fetch(refreshUrl, {
      cache: "no-store",
      headers: {
        "User-Agent": "crazy-sajangnim-catalog-refresh/1.0",
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

    const result: RefreshResult = {
      market,
      gender,
      ok: response.ok,
      status: response.status,
      count: body.count,
      savedCount: body.diagnostics?.savedCount,
      error: body.error ?? body.diagnostics?.persistenceError ?? undefined,
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
