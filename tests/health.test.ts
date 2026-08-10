import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * These pin the behaviour that was missing when the shop served an
 * empty page for a day: a storefront with nothing in it has to read as
 * an outage, and an unauthenticated caller has to be told so by the
 * status code, because that is what an uptime monitor can see.
 */

const from = vi.hoisted(() => vi.fn());
const rpcClient = vi.hoisted(() => ({ from }));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => rpcClient,
}));

vi.mock("@/lib/products/brand-sync", () => ({
  findBrandDrift: vi.fn(async () => ({
    orphaned: [],
    empty: [],
    catalogBrands: 27,
    trackedBrands: 27,
  })),
}));

vi.mock("@/lib/search/web-search", () => ({
  searchHealth: () => [
    { name: "google", configured: true, disabled: false },
  ],
}));

const authorized = vi.hoisted(() => vi.fn());

vi.mock("@/lib/service-auth", () => ({
  isAuthorizedService: authorized,
  unauthorizedResponse: () => new Response("no", { status: 401 }),
}));

/*
 * A query builder that answers whatever the case wants. Every method
 * returns itself so the chain works however it is composed.
 */
function stubCatalog({ productCount }: { productCount: number }) {
  from.mockImplementation((table: string) => {
    const result =
      table === "product_catalog"
        ? { count: productCount, error: null, data: null }
        : { count: 27, error: null, data: null };

    const builder: Record<string, unknown> = {};

    for (const method of ["select", "eq", "in", "order", "limit"]) {
      builder[method] = () => builder;
    }

    builder.maybeSingle = async () => ({
      data: { collected_at: new Date().toISOString() },
      error: null,
    });

    /* Awaiting the chain resolves to the count query's result. */
    builder.then = (resolve: (value: unknown) => unknown) => resolve(result);

    return builder;
  });
}

async function callHealth() {
  const { GET } = await import("@/app/api/health/route");

  return GET(new Request("https://backend.example/api/health"));
}

beforeEach(() => {
  vi.resetModules();
  from.mockReset();
  authorized.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a storefront with nothing to sell", () => {
  it("reads as down, not degraded, for an authorized caller", async () => {
    authorized.mockReturnValue(true);
    stubCatalog({ productCount: 0 });

    const response = await callHealth();
    const body = (await response.json()) as {
      status: string;
      checks: { name: string; ok: boolean }[];
    };

    expect(body.status).toBe("down");
    expect(response.status).toBe(503);
    expect(body.checks.find((c) => c.name === "storefronts")?.ok).toBe(false);
  });

  it("answers 503 to an unauthenticated monitor, with no detail", async () => {
    authorized.mockReturnValue(false);
    stubCatalog({ productCount: 0 });

    const response = await callHealth();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "down" });
    /* No check names, no counts, no reasons. */
    expect(Object.keys(body)).toEqual(["status"]);
  });
});

describe("a storefront with stock", () => {
  it("reads as ok for an authorized caller", async () => {
    authorized.mockReturnValue(true);
    stubCatalog({ productCount: 500 });

    const response = await callHealth();
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("answers 200 to an unauthenticated monitor", async () => {
    authorized.mockReturnValue(false);
    stubCatalog({ productCount: 500 });

    const response = await callHealth();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
