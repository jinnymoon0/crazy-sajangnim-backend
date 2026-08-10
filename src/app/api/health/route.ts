import { NextResponse } from "next/server";

import { findBrandDrift } from "@/lib/products/brand-sync";
import { KNOWN_STOCKISTS } from "@/lib/products/known-stockists";
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

  const configured = providers.filter((provider) => provider.configured);

  /*
   * Nothing configured at all is a decision, not a fault. Stockist
   * discovery is an improvement on top of the collectors — the catalog
   * refreshes from the retailers either way — and running without it is
   * a legitimate way to run.
   *
   * Reporting that as a problem would leave this check permanently
   * amber, and a warning that is always on is one nobody reads. The
   * distinction that matters is configured-and-broken, which is a real
   * failure because it looks from outside exactly like a quiet day.
   */
  if (configured.length === 0) {
    return {
      name: "search",
      ok: true,
      detail: `no search provider — discovery is running on the ${KNOWN_STOCKISTS.length} curated stockists only`,
    };
  }

  return {
    name: "search",
    ok: usable.length > 0,
    detail:
      broken.length > 0
        ? broken
            .map((provider) => `${provider.name}: ${provider.reason}`)
            .join("; ")
        : `${usable.length} provider(s) available`,
  };
}

/*
 * Whether each storefront actually has anything to sell.
 *
 * This is the check that was missing, and its absence is why the shop
 * could serve an empty page for a day without anything noticing. Every
 * other check passed while it happened: the database answered, the
 * catalog had been collected recently, the brands were tracked. Four
 * thousand rows had simply been marked unavailable by a statement run
 * outside the application, and nothing here was looking at the one
 * number a shop exists to produce.
 *
 * A storefront with no stock is an outage, not a degradation. It is
 * indistinguishable, to whoever opens the site, from the service being
 * down.
 */
async function checkStorefronts(): Promise<Check & { empty: string[] }> {
  const combinations = [
    { market: "US", gender: "MEN" },
    { market: "US", gender: "WOMEN" },
    { market: "KR", gender: "MEN" },
    { market: "KR", gender: "WOMEN" },
  ];

  try {
    const counts = await Promise.all(
      combinations.map(async ({ market, gender }) => {
        const { count, error } = await getSupabaseAdmin()
          .from("product_catalog")
          .select("id", { count: "exact", head: true })
          .eq("market", market)
          /* UNISEX shows on both, exactly as the storefront reads it. */
          .in("gender", [gender, "UNISEX"])
          .eq("is_available", true)
          .eq("sale_verification", "VERIFIED");

        if (error) {
          throw new Error(error.message);
        }

        return { label: `${market}/${gender}`, count: count ?? 0 };
      }),
    );

    const empty = counts.filter((entry) => entry.count === 0);

    return {
      name: "storefronts",
      ok: empty.length === 0,
      empty: empty.map((entry) => entry.label),
      detail: counts
        .map((entry) => `${entry.label} ${entry.count}`)
        .join(", "),
    };
  } catch (error) {
    return {
      name: "storefronts",
      ok: false,
      empty: ["unknown"],
      detail:
        error instanceof Error ? error.message : "could not count the catalog",
    };
  }
}

export async function GET(request: Request) {
  /*
   * Liveness only for an unauthenticated caller. Which provider is
   * misconfigured and how stale the catalog is are operational details,
   * and a stranger learning them gains nothing good.
   */
  const authorized = isAuthorizedService(request);

  /*
   * An unauthenticated caller learns whether the service is serving,
   * and nothing else — but it learns it truthfully, through the status
   * code. That is deliberate: it lets any free uptime monitor watch
   * this without a token and without depending on our own scheduler,
   * which is the failure that let a day of emptiness go unnoticed.
   */
  if (!authorized) {
    const storefronts = await checkStorefronts();
    const database = await checkDatabase();

    const serving = database.ok && storefronts.ok;

    return NextResponse.json(
      { status: serving ? "ok" : "down" },
      {
        status: serving ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const [database, catalog, brands, storefronts] = await Promise.all([
    checkDatabase(),
    checkCatalogFreshness(),
    checkBrandDrift(),
    checkStorefronts(),
  ]);

  const checks = [database, catalog, brands, storefronts, checkSearch()];

  const failing = checks.filter((check) => !check.ok);

  return NextResponse.json(
    {
      /*
       * The database being unreachable and a storefront having nothing
       * to sell are both outages: from the outside they look the same,
       * which is a blank page. Everything else is a degradation worth
       * reporting without paging anyone.
       */
      status:
        !database.ok || !storefronts.ok
          ? "down"
          : failing.length === 0
            ? "ok"
            : "degraded",
      checks,
    },
    {
      status: database.ok && storefronts.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
