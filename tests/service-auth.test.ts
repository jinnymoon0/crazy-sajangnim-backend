import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isAuthorizedService } from "@/lib/service-auth";

const TOKEN = "s3cret-token-value";

function requestWith(authorization?: string): Request {
  return new Request("https://backend.example/api/products", {
    headers: authorization ? { authorization } : {},
  });
}

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.BACKEND_API_TOKEN;
  delete process.env.VERCEL;
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.env = { ...originalEnv };
});

describe("when a token is configured", () => {
  beforeEach(() => {
    process.env.BACKEND_API_TOKEN = TOKEN;
  });

  it("accepts the right one", () => {
    expect(isAuthorizedService(requestWith(`Bearer ${TOKEN}`))).toBe(true);
  });

  it("rejects a wrong one", () => {
    expect(isAuthorizedService(requestWith("Bearer wrong-token-value"))).toBe(
      false,
    );
  });

  it("rejects one that is merely a prefix of the real one", () => {
    expect(isAuthorizedService(requestWith(`Bearer ${TOKEN.slice(0, 8)}`))).toBe(
      false,
    );
  });

  it("rejects one with the right value and extra on the end", () => {
    expect(isAuthorizedService(requestWith(`Bearer ${TOKEN}extra`))).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(isAuthorizedService(requestWith())).toBe(false);
  });

  it("rejects the token without the Bearer scheme", () => {
    expect(isAuthorizedService(requestWith(TOKEN))).toBe(false);
  });

  it("rejects another scheme carrying the right value", () => {
    expect(isAuthorizedService(requestWith(`Basic ${TOKEN}`))).toBe(false);
  });

  it("does not accept an empty bearer against a configured token", () => {
    expect(isAuthorizedService(requestWith("Bearer "))).toBe(false);
  });
});

describe("when no token is configured", () => {
  /*
   * This is the case that mattered. The check used to be skipped
   * whenever the variable was absent — everywhere, including
   * production. A deployment that lost the variable through a typo
   * served the catalog writes and the brand deletion to anyone who
   * asked, and nothing looked wrong from outside.
   */
  it("refuses everything on Vercel", () => {
    process.env.VERCEL = "1";

    expect(isAuthorizedService(requestWith())).toBe(false);
    expect(isAuthorizedService(requestWith("Bearer anything"))).toBe(false);
  });

  it("refuses everything when NODE_ENV says production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(isAuthorizedService(requestWith("Bearer anything"))).toBe(false);
  });

  it("still lets local development through", () => {
    expect(isAuthorizedService(requestWith())).toBe(true);
  });
});

describe("comparison timing", () => {
  /*
   * A plain === returns as soon as two bytes differ, so the time taken
   * reveals the position of the first wrong byte and the token can be
   * recovered one byte at a time. This cannot prove constant time on a
   * noisy machine; it checks the shape — that a token differing in the
   * first byte is not systematically faster than one differing in the
   * last.
   */
  it("does not return sooner for a token that goes wrong early", () => {
    process.env.BACKEND_API_TOKEN = TOKEN;

    const wrongFirst = `Bearer X${TOKEN.slice(1)}`;
    const wrongLast = `Bearer ${TOKEN.slice(0, -1)}X`;

    const measure = (header: string) => {
      const started = process.hrtime.bigint();

      for (let i = 0; i < 2_000; i += 1) {
        isAuthorizedService(requestWith(header));
      }

      return Number(process.hrtime.bigint() - started);
    };

    /* Warm up, so the first measurement is not paying for JIT. */
    measure(wrongFirst);
    measure(wrongLast);

    /*
     * The fastest of several rounds, not one round.
     *
     * A single sample measures the machine as much as the comparison.
     * Run alone this passed every time; run with the rest of the suite,
     * where other files are using the same cores, it failed about one
     * run in three on a ratio of 2.3 — noise from being descheduled
     * mid-measurement, reported as a timing leak that was not there.
     *
     * The minimum is the run that got a clean go at the CPU, so
     * comparing minima compares the comparison rather than the load.
     */
    const fastest = (header: string) => {
      let best = Infinity;

      for (let round = 0; round < 5; round += 1) {
        best = Math.min(best, measure(header));
      }

      return best;
    };

    const ratio = fastest(wrongFirst) / fastest(wrongLast);

    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });
});
