import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Gender, Market } from "@/types/product";

import type { DiscoveredRetailer } from "./retailer-discovery";

export interface RetailerRecord {
  domain: string;
  platform: "shopify" | "cafe24";
  market: Market;
  defaultGender: Gender;
}

/*
 * The stockists that used to be a list in the code. Kept as a fallback
 * so the collector still works before the table exists, or if reading it
 * fails — losing the shops would empty the American storefront.
 */
const SEED_RETAILERS: RetailerRecord[] = [
  { domain: "svrn.com", platform: "shopify", market: "US", defaultGender: "UNISEX" },
  { domain: "mohawkgeneralstore.com", platform: "shopify", market: "US", defaultGender: "UNISEX" },
  { domain: "notre-shop.com", platform: "shopify", market: "US", defaultGender: "UNISEX" },
  { domain: "standardandstrange.com", platform: "shopify", market: "US", defaultGender: "MEN" },
  { domain: "blueowl.us", platform: "shopify", market: "US", defaultGender: "MEN" },
  { domain: "unionlosangeles.com", platform: "shopify", market: "US", defaultGender: "MEN" },
  { domain: "stagprovisions.com", platform: "shopify", market: "US", defaultGender: "MEN" },
  { domain: "snakeoilprovisions.com", platform: "shopify", market: "US", defaultGender: "MEN" },
  { domain: "featuresneakerboutique.com", platform: "shopify", market: "US", defaultGender: "MEN" },
];

interface RetailerRow {
  domain: string;
  platform: string;
  market: string;
  default_gender: string;
}

function toRecord(row: RetailerRow): RetailerRecord {
  return {
    domain: row.domain,
    platform: row.platform === "cafe24" ? "cafe24" : "shopify",
    market: row.market === "KR" ? "KR" : "US",
    defaultGender:
      row.default_gender === "MEN"
        ? "MEN"
        : row.default_gender === "WOMEN"
          ? "WOMEN"
          : "UNISEX",
  };
}

export async function getRetailers(
  platform?: "shopify" | "cafe24",
): Promise<RetailerRecord[]> {
  try {
    let query = getSupabaseAdmin()
      .from("retailers")
      .select("domain, platform, market, default_gender")
      .eq("is_active", true);

    if (platform) {
      query = query.eq("platform", platform);
    }

    const { data, error } = await query;

    if (error) {
      if (error.code !== "42P01" && error.code !== "PGRST205") {
        console.error("Retailer lookup failed:", error.message);
      }

      return platform === "cafe24"
        ? []
        : SEED_RETAILERS.filter((r) => !platform || r.platform === platform);
    }

    const rows = (data ?? []) as RetailerRow[];

    if (rows.length === 0 && platform !== "cafe24") {
      return SEED_RETAILERS.filter((r) => !platform || r.platform === platform);
    }

    return rows.map(toRecord);
  } catch (error) {
    console.error("Retailer lookup error:", error);

    return platform === "cafe24"
      ? []
      : SEED_RETAILERS.filter((r) => !platform || r.platform === platform);
  }
}

/*
 * Remember shops found while adding a brand. A shop already listed keeps
 * whatever gender it was given by hand; only the note of when its brand
 * was last seen there is refreshed.
 */
export async function rememberRetailers(
  retailers: DiscoveredRetailer[],
  discoveredFor: string,
): Promise<number> {
  if (retailers.length === 0) {
    return 0;
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("retailers")
      .upsert(
        retailers.map((retailer) => ({
          domain: retailer.domain,
          platform: retailer.platform,
          market: retailer.market,
          discovered_via: "search",
          discovered_for: discoveredFor,
          last_verified_at: new Date().toISOString(),
        })),
        { onConflict: "domain", ignoreDuplicates: false },
      )
      .select("domain");

    if (error) {
      console.error("Could not save discovered shops:", error.message);

      return 0;
    }

    return (data ?? []).length;
  } catch (error) {
    console.error("Could not save discovered shops:", error);

    return 0;
  }
}
