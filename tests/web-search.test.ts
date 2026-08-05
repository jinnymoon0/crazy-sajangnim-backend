import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetSearchHealth,
  searchHealth,
  searchProviderName,
  searchWeb,
} from "@/lib/search/web-search";

const searchSearxng = vi.hoisted(() => vi.fn());

vi.mock("@/lib/search/searxng", () => ({ searchSearxng }));

/* Every provider off unless a case turns one on. */
const SEARCH_VARS = [
  "GOOGLE_SEARCH_API_KEY",
  "GOOGLE_SEARCH_ENGINE_ID",
  "BRAVE_SEARCH_API_KEY",
  "SERPER_API_KEY",
  "SEARXNG_URL",
  "VERCEL",
] as const;

function clearProviders() {
  for (const name of SEARCH_VARS) {
    delete process.env[name];
  }
}

function googleReturning(status: number, body: unknown) {
  process.env.GOOGLE_SEARCH_API_KEY = "key";
  process.env.GOOGLE_SEARCH_ENGINE_ID = "engine";

  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  clearProviders();
  resetSearchHealth();
  searchSearxng.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearProviders();
});

describe("a provider that is permanently misconfigured", () => {
  it("is asked once, then left alone", async () => {
    /*
     * The real symptom: the project had no access to the Custom Search
     * API, and every query spent a request to be told so again.
     */
    const fetchMock = googleReturning(403, {
      error: { message: "This project does not have the access." },
    });

    vi.stubGlobal("fetch", fetchMock);

    await searchWeb("first");
    await searchWeb("second");
    await searchWeb("third");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says why, rather than looking like an empty result", async () => {
    vi.stubGlobal(
      "fetch",
      googleReturning(403, {
        error: { message: "This project does not have the access." },
      }),
    );

    await searchWeb("anything");

    const google = searchHealth().find((p) => p.name === "google");

    expect(google?.disabled).toBe(true);
    expect(google?.reason).toContain("does not have the access");
  });

  it("drops out of the reported provider name", async () => {
    vi.stubGlobal("fetch", googleReturning(403, { error: {} }));

    expect(searchProviderName()).toBe("google");

    await searchWeb("anything");

    expect(searchProviderName()).toBe("none");
  });
});

describe("a provider that is merely out of allowance", () => {
  it("keeps being asked, because tomorrow it works again", async () => {
    /* 429 is the free daily hundred spent, not a broken setup. */
    const fetchMock = googleReturning(429, {});

    vi.stubGlobal("fetch", fetchMock);

    await searchWeb("first");
    await searchWeb("second");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(searchHealth().find((p) => p.name === "google")?.disabled).toBe(
      false,
    );
  });
});

describe("falling through the cascade", () => {
  it("returns the first provider's results without asking the rest", async () => {
    const fetchMock = googleReturning(200, {
      items: [{ title: "Stone Island", link: "https://stoneisland.com" }],
    });

    process.env.SEARXNG_URL = "http://searx.example";
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchWeb("stone island");

    expect(results).toEqual([
      { title: "Stone Island", url: "https://stoneisland.com" },
    ]);
    expect(searchSearxng).not.toHaveBeenCalled();
  });

  it("moves on when a provider answers with nothing", async () => {
    vi.stubGlobal("fetch", googleReturning(200, { items: [] }));

    process.env.SEARXNG_URL = "http://searx.example";
    searchSearxng.mockResolvedValue({
      results: [{ title: "Found", url: "https://shop.example" }],
      unresponsiveEngines: [],
    });

    const results = await searchWeb("stone island");

    expect(results).toEqual([{ title: "Found", url: "https://shop.example" }]);
  });

  it("returns empty, not an error, when nothing is configured", async () => {
    await expect(searchWeb("stone island")).resolves.toEqual([]);
  });
});

describe("a SearXNG that cannot be reached", () => {
  it("is not asked twice in the same run", async () => {
    /*
     * Discovery issues several queries seconds apart. A host that was
     * unreachable for the first has not appeared for the second, and
     * paying the timeout again for each one is what made adding a
     * brand take a minute.
     */
    process.env.SEARXNG_URL = "http://searx.example";
    searchSearxng.mockRejectedValue(new Error("The operation was aborted"));

    await searchWeb("first");
    await searchWeb("second");
    await searchWeb("third");

    expect(searchSearxng).toHaveBeenCalledTimes(1);
  });

  it("is skipped outright when it points at a local address in a deployment", async () => {
    process.env.VERCEL = "1";
    process.env.SEARXNG_URL = "http://localhost:8888";

    const results = await searchWeb("stone island");

    expect(results).toEqual([]);
    expect(searchSearxng).not.toHaveBeenCalled();

    const searxng = searchHealth().find((p) => p.name === "searxng");

    expect(searxng?.disabled).toBe(true);
    expect(searxng?.reason).toContain("cannot be reached");
  });

  it.each(["http://127.0.0.1:8888", "http://10.0.0.4:8888", "http://192.168.1.9"])(
    "treats %s as unreachable from a deployment",
    async (url) => {
      process.env.VERCEL = "1";
      process.env.SEARXNG_URL = url;

      await searchWeb("stone island");

      expect(searchSearxng).not.toHaveBeenCalled();
    },
  );

  it("is still used at a local address when running locally", async () => {
    process.env.SEARXNG_URL = "http://localhost:8888";
    searchSearxng.mockResolvedValue({
      results: [{ title: "Local", url: "https://shop.example" }],
      unresponsiveEngines: [],
    });

    const results = await searchWeb("stone island");

    expect(results).toEqual([{ title: "Local", url: "https://shop.example" }]);
  });
});

describe("the time the whole cascade may take", () => {
  it("hands SearXNG a budget rather than letting it use its own", async () => {
    process.env.SEARXNG_URL = "http://searx.example";
    searchSearxng.mockResolvedValue({ results: [], unresponsiveEngines: [] });

    await searchWeb("stone island");

    const [, options] = searchSearxng.mock.calls[0] as [
      string,
      { budgetMs?: number },
    ];

    expect(options.budgetMs).toBeGreaterThan(0);
    expect(options.budgetMs).toBeLessThanOrEqual(20_000);
  });
});
