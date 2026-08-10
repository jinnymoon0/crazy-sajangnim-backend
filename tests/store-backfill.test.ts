import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * KLEESIER had a perfectly discoverable shop and sat empty for hours,
 * purely because discovery failed the once and nothing ever asked
 * again. These pin the two things that would bring that back: a brand
 * that never comes round in the rotation, and a probe that takes the
 * refresh down with it when a shop misbehaves.
 */

const brands = vi.hoisted(() => vi.fn());
const discover = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn(() => ({ eq: async () => ({ error: null }) })));

vi.mock("@/lib/products/brand-repository", () => ({
  getBrands: brands,
}));

vi.mock("@/lib/products/brand-store-discovery", () => ({
  discoverBrandStore: discover,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({ from: () => ({ update }) }),
}));

function brand(slug: string, storeDomain: string | null) {
  return {
    slug,
    englishName: slug.toUpperCase(),
    koreanName: null,
    aliases: [],
    isActive: true,
    addedBy: null,
    createdAt: null,
    storeDomain,
  };
}

describe("backfillMissingStores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    discover.mockResolvedValue(null);
  });

  it("only ever probes brands with no shop on file", async () => {
    brands.mockResolvedValue([
      brand("alpha", "alpha.com"),
      brand("bravo", null),
      brand("charlie", "charlie.co.kr"),
    ]);

    const { backfillMissingStores } = await import(
      "@/lib/products/store-backfill"
    );

    for (let hour = 0; hour < 24; hour += 1) {
      await backfillMissingStores(hour);
    }

    const probed = discover.mock.calls.map((call) => call[1]);

    expect(new Set(probed)).toEqual(new Set(["bravo"]));
  });

  it("reaches every storeless brand as the hours go round", async () => {
    const missing = ["b", "d", "f", "h", "j"];

    brands.mockResolvedValue([
      brand("a", "a.com"),
      ...missing.map((s) => brand(s, null)),
    ]);

    const { backfillMissingStores } = await import(
      "@/lib/products/store-backfill"
    );

    const seen = new Set<string>();

    for (let hour = 0; hour < 24; hour += 1) {
      const result = await backfillMissingStores(hour);

      result.attempted.forEach((slug) => seen.add(slug));
    }

    /*
     * The point of keying on the clock rather than a counter: no brand
     * is starved. One left out would be a KLEESIER that stays empty for
     * ever, which is the whole failure being fixed.
     */
    expect(seen).toEqual(new Set(missing));
  });

  it("is stable — the same hour always picks the same brand", async () => {
    brands.mockResolvedValue([brand("x", null), brand("y", null)]);

    const { backfillMissingStores } = await import(
      "@/lib/products/store-backfill"
    );

    const first = await backfillMissingStores(7);
    const again = await backfillMissingStores(7);

    expect(first.attempted).toEqual(again.attempted);
  });

  it("saves a shop it finds", async () => {
    brands.mockResolvedValue([brand("zulu", null)]);

    discover.mockResolvedValue({
      domain: "zulu.co.kr",
      platform: "cafe24",
      market: "KR",
    });

    const { backfillMissingStores } = await import(
      "@/lib/products/store-backfill"
    );

    const result = await backfillMissingStores(0);

    expect(result.found).toEqual([
      { slug: "zulu", domain: "zulu.co.kr", platform: "cafe24" },
    ]);

    expect(update).toHaveBeenCalledWith({
      store_domain: "zulu.co.kr",
      store_platform: "cafe24",
      store_market: "KR",
    });
  });

  it("swallows a failing probe rather than failing the refresh", async () => {
    brands.mockResolvedValue([brand("boom", null)]);

    discover.mockRejectedValue(new Error("the shop hung up"));

    const { backfillMissingStores } = await import(
      "@/lib/products/store-backfill"
    );

    /*
     * This runs alongside the hourly collection. A brand whose shop is
     * unreachable must never stop the catalogue being refreshed.
     */
    await expect(backfillMissingStores(0)).resolves.toMatchObject({
      attempted: ["boom"],
      found: [],
    });
  });

  it("does nothing when every brand already has a shop", async () => {
    brands.mockResolvedValue([brand("solo", "solo.com")]);

    const { backfillMissingStores } = await import(
      "@/lib/products/store-backfill"
    );

    await expect(backfillMissingStores(3)).resolves.toEqual({
      considered: 0,
      attempted: [],
      found: [],
    });

    expect(discover).not.toHaveBeenCalled();
  });
});
