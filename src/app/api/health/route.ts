import { NextResponse } from "next/server";

import { findBrandDrift } from "@/lib/products/brand-sync";
import { searchHealth } from "@/lib/search/web-search";
import { isAuthorizedService } from "@/lib/service-auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const maxDuration = 60;

/*
 * Is the service working, and if it is only half working, which half.
 *
 * Two levels. Without a token it answers whether the process is up,
 * which is all an uptime pinger needs and all a stranger should learn.
 * With one it reports the things that fail quietly: a search provider
 * that has been refusing since a key expired, a catalog that has not
 * been refreshed since the cron broke, brands whose products no longer
 * match the brand list.
 *
 * Those are the failures worth an endpoint. Something loudly broken is
 * already visible; what costs weeks is a system that looks fine and has
 * silently stopped doing one of its jobs.
 */
interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

async function checkDatabase(): Promise<Check> {
  const started = Date.now();

  try {
    const { error } = await getSupabaseAdmin()
      .from("brands")
      .select("slug", { count: "exact", head: true });

    if (error) {
      /*
       * Include the code. A health check whose failure detail is an
       * empty string — which is what a connection refused before the
       * client is ready produces — tells whoever is woken up nothing
       * at all.
       */
      return {
        name: "database",
        ok: false,
        detail:
          [error.code, error.message].filter(Boolean).join(" ") ||
          "the query failed without saying why",
      };
    }

    return {
      name: "database",
      ok: true,
      detail: `${Date.now() - started}ms`,
    };
  } catch (error) {
    return {
      name: "database",
      ok: false,
      detail: error instanceof Error ? error.message : "unreachable",
    };
  }
}

/*
 * How long ago the catalog was last written to. The nightly refresh
 * once failed for weeks without anyone noticing, because a stale
 * catalog looks exactly like a fresh one.
 */
async function checkCatalogFreshness(): Promise<Check> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("product_catalog")
      .select("collected_at")
      .order("collected_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return { name: "catalog", ok: false, detail: error.message };
    }

    const collectedAt = (data as { collected_at: string } | null)?.collected_at;

    if (!collectedAt) {
      return { name: "catalog", ok: false, detail: "the catalog is empty" };
    }

    const hours = (Date.now() - new Date(collectedAt).getTime()) / 3_600_000;

    return {
      name: "catalog",
      /* The refresh is nightly, so a day and a half means it missed one. */
      ok: hours < 36,
      detail: `last collected ${hours.toFixed(1)}h ago`,
    };
  } catch (error) {
    return {
      name: "catalog",
      ok: false,
      detail: error instanceof Error ? error.message : "unreadable",
    };
  }
}

async function checkBrandDrift(): Promise<Check> {
  try {
    const drift = await findBrandDrift();

    return {
      name: "brands",
      ok: drift.orphaned.length === 0,
      detail:
        drift.orphaned.length === 0
          ? `${drift.trackedBrands} tracked, all products accounted for`
          : `${drift.orphaned.length} slug(s) in the catalog are not tracked: ${drift.orphaned
              .map((entry) => `${entry.slug} (${entry.products})`)
              .join(", ")}`,
    };
  } catch (error) {
    return {
      name: "brands",
      ok: false,
      detail: error instanceof Error ? error.message : "could not compare",
    };
  }
}

function checkSearch(): Check {
  const providers = searchHealth();

  const usable = providers.filter(
    (provider) => provider.configured && !provider.disabled,
  );

  const broken = providers.filter(
    (provider) => provider.configured && provider.disabled,
  );

  return {
    name: "search",
    /*
     * Not being able to search is a degradation, not an outage:
     * discovery is an improvement on top of the collectors, and the
     * catalog refreshes without it. It still needs saying, because it
     * fails by finding nothing, which looks like a quiet day.
     */
    ok: usable.length > 0,
    detail:
      broken.length > 0
        ? broken
            .map((provider) => `${provider.name}: ${provider.reason}`)
            .join("; ")
        : `${usable.length} provider(s) available`,
  };
}

export async function GET(request: Request) {
  /*
   * Liveness only for an unauthenticated caller. Which provider is
   * misconfigured and how stale the catalog is are operational details,
   * and a stranger learning them gains nothing good.
   */
  if (!isAuthorizedService(request)) {
    return NextResponse.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const [database, catalog, brands] = await Promise.all([
    checkDatabase(),
    checkCatalogFreshness(),
    checkBrandDrift(),
  ]);

  const checks = [database, catalog, brands, checkSearch()];

  const failing = checks.filter((check) => !check.ok);

  return NextResponse.json(
    {
      /*
       * The database being down is an outage; everything else is a
       * degradation worth reporting without paging anyone.
       */
      status: database.ok ? (failing.length === 0 ? "ok" : "degraded") : "down",
      checks,
    },
    {
      status: database.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
