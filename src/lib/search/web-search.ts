import { searchSearxng } from "@/lib/search/searxng";

export interface WebResult {
  title: string;
  url: string;
}

/*
 * How long the whole cascade may take, however many providers it tries.
 *
 * Each provider used to carry its own timeout and nothing bounded the
 * sum, so a provider that accepts a connection and then says nothing
 * cost the full amount before the next one was even attempted. Measured
 * against a host that drops packets: 22s for a single query, and
 * discovery issues three per brand.
 */
const TOTAL_BUDGET_MS = 20_000;

/* No single provider may eat the whole budget and starve the rest. */
const PER_PROVIDER_MS = 8_000;

/*
 * Providers that have failed in a way that will not fix itself, and why.
 *
 * A wrong key or a project without the API enabled fails identically on
 * every request. Retrying it once per query spent a request and a round
 * trip each time to learn the same thing, so it is asked once and then
 * left alone. Reset when the process restarts, which is also when the
 * configuration could have changed.
 */
const disabledProviders = new Map<string, string>();

export interface ProviderHealth {
  name: string;
  configured: boolean;
  disabled: boolean;
  reason?: string;
}

/*
 * A status a permanent misconfiguration, as opposed to a provider
 * having a bad minute. 401/403 are credentials; 400 is a malformed
 * request, which will stay malformed.
 */
function isPermanentFailure(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

function remaining(deadline: number): number {
  return deadline - Date.now();
}

/*
 * A URL a deployed copy could never reach: loopback, link-local, or a
 * private range. SearXNG is configured at localhost for development,
 * and a serverless function resolving that address finds only itself.
 *
 * Only skipped when actually deployed — locally it is exactly right.
 */
function isUnreachableWhenDeployed(rawUrl: string): boolean {
  if (!process.env.VERCEL) {
    return false;
  }

  try {
    const { hostname } = new URL(rawUrl);

    return (
      hostname === "localhost" ||
      hostname === "::1" ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

/*
 * Ask the web a question, through whichever provider answers first.
 *
 * Google's programmable search first: a hundred queries a day, free, no
 * card. Then Brave or Serper for anyone who wants more, then SearXNG.
 *
 * Returns an empty list when nothing is configured or reachable.
 * Callers treat that as "found no shops", never as an error: brand
 * discovery is an improvement on top of the collectors, not something
 * they depend on. Ask searchHealth() to tell the two apart.
 */
export async function searchWeb(query: string): Promise<WebResult[]> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  const googleKey = process.env.GOOGLE_SEARCH_API_KEY?.trim();
  const googleEngine = process.env.GOOGLE_SEARCH_ENGINE_ID?.trim();

  if (googleKey && googleEngine && !disabledProviders.has("google")) {
    const results = await searchGoogle(query, googleKey, googleEngine, deadline);

    if (results.length > 0) {
      return results;
    }
  }

  const brave = process.env.BRAVE_SEARCH_API_KEY?.trim();

  if (brave && !disabledProviders.has("brave") && remaining(deadline) > 0) {
    const results = await searchBrave(query, brave, deadline);

    if (results.length > 0) {
      return results;
    }
  }

  const serper = process.env.SERPER_API_KEY?.trim();

  if (serper && !disabledProviders.has("serper") && remaining(deadline) > 0) {
    const results = await searchSerper(query, serper, deadline);

    if (results.length > 0) {
      return results;
    }
  }

  const searxng = process.env.SEARXNG_URL?.trim();

  if (!searxng) {
    return [];
  }

  if (isUnreachableWhenDeployed(searxng)) {
    disabledProviders.set(
      "searxng",
      `${searxng} is a local address and cannot be reached from a deployment.`,
    );

    return [];
  }

  if (disabledProviders.has("searxng") || remaining(deadline) <= 0) {
    return [];
  }

  try {
    const response = await searchSearxng(query, {
      budgetMs: Math.max(1, remaining(deadline)),
    });

    return response.results.map((result) => ({
      title: result.title,
      url: result.url,
    }));
  } catch (error) {
    /*
     * Unreachable or too slow. Discovery issues several queries in a
     * row seconds apart, and a host that could not be reached for the
     * first will not have appeared for the second — so stop asking
     * rather than spending the whole budget again on each one.
     */
    disabledProviders.set(
      "searxng",
      error instanceof Error ? error.message : "SearXNG could not be reached.",
    );

    console.error(`Web search for ${query} found nothing:`, error);

    return [];
  }
}

async function searchGoogle(
  query: string,
  key: string,
  engineId: string,
  deadline: number,
): Promise<WebResult[]> {
  try {
    const url = new URL("https://www.googleapis.com/customsearch/v1");

    url.searchParams.set("key", key);
    url.searchParams.set("cx", engineId);
    url.searchParams.set("q", query);
    url.searchParams.set("num", "10");

    const response = await fetch(url, {
      signal: AbortSignal.timeout(
        Math.min(PER_PROVIDER_MS, Math.max(1, remaining(deadline))),
      ),
    });

    if (!response.ok) {
      /*
       * 429 is the daily hundred spent — tomorrow it works again, so it
       * is not a reason to stop asking. 403 means the project has no
       * access to the Custom Search API, which no amount of retrying
       * changes.
       */
      if (response.status === 429) {
        console.error("Google search: the free daily allowance is spent.");
      } else if (isPermanentFailure(response.status)) {
        const detail = await response
          .json()
          .then(
            (body: { error?: { message?: string } }) => body.error?.message,
          )
          .catch(() => undefined);

        disabledProviders.set(
          "google",
          detail ?? `Google returned ${response.status}.`,
        );

        console.error(
          `Google search disabled for this run: ${detail ?? response.status}`,
        );
      } else {
        console.error(`Google search returned ${response.status}`);
      }

      return [];
    }

    const body = (await response.json()) as {
      items?: { title?: string; link?: string }[];
    };

    return (body.items ?? [])
      .filter((item): item is { title: string; link: string } =>
        Boolean(item.link),
      )
      .map((item) => ({ title: item.title ?? "", url: item.link }));
  } catch (error) {
    console.error("Google search failed:", error);

    return [];
  }
}

async function searchBrave(
  query: string,
  key: string,
  deadline: number,
): Promise<WebResult[]> {
  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20`,
      {
        headers: { Accept: "application/json", "X-Subscription-Token": key },
        signal: AbortSignal.timeout(
          Math.min(PER_PROVIDER_MS, Math.max(1, remaining(deadline))),
        ),
      },
    );

    if (!response.ok) {
      if (isPermanentFailure(response.status)) {
        disabledProviders.set("brave", `Brave returned ${response.status}.`);
      }

      console.error(`Brave search returned ${response.status}`);

      return [];
    }

    const body = (await response.json()) as {
      web?: { results?: { title?: string; url?: string }[] };
    };

    return (body.web?.results ?? [])
      .filter((result): result is { title: string; url: string } =>
        Boolean(result.url),
      )
      .map((result) => ({ title: result.title ?? "", url: result.url }));
  } catch (error) {
    console.error("Brave search failed:", error);

    return [];
  }
}

async function searchSerper(
  query: string,
  key: string,
  deadline: number,
): Promise<WebResult[]> {
  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 20 }),
      signal: AbortSignal.timeout(
        Math.min(PER_PROVIDER_MS, Math.max(1, remaining(deadline))),
      ),
    });

    if (!response.ok) {
      if (isPermanentFailure(response.status)) {
        disabledProviders.set("serper", `Serper returned ${response.status}.`);
      }

      console.error(`Serper search returned ${response.status}`);

      return [];
    }

    const body = (await response.json()) as {
      organic?: { title?: string; link?: string }[];
    };

    return (body.organic ?? [])
      .filter((result): result is { title: string; link: string } =>
        Boolean(result.link),
      )
      .map((result) => ({ title: result.title ?? "", url: result.link }));
  } catch (error) {
    console.error("Serper search failed:", error);

    return [];
  }
}

export function searchProviderName(): string {
  if (
    process.env.GOOGLE_SEARCH_API_KEY?.trim() &&
    process.env.GOOGLE_SEARCH_ENGINE_ID?.trim() &&
    !disabledProviders.has("google")
  ) {
    return "google";
  }

  if (
    process.env.BRAVE_SEARCH_API_KEY?.trim() &&
    !disabledProviders.has("brave")
  ) {
    return "brave";
  }

  if (process.env.SERPER_API_KEY?.trim() && !disabledProviders.has("serper")) {
    return "serper";
  }

  if (
    process.env.SEARXNG_URL?.trim() &&
    !disabledProviders.has("searxng") &&
    !isUnreachableWhenDeployed(process.env.SEARXNG_URL.trim())
  ) {
    return "searxng";
  }

  return "none";
}

/*
 * What each provider is doing, so a search that quietly finds nothing
 * can be told apart from one that was never going to work. Read by the
 * health endpoint and by the admin when discovery turns up empty.
 */
export function searchHealth(): ProviderHealth[] {
  const searxngUrl = process.env.SEARXNG_URL?.trim();

  const configured: Record<string, boolean> = {
    google: Boolean(
      process.env.GOOGLE_SEARCH_API_KEY?.trim() &&
        process.env.GOOGLE_SEARCH_ENGINE_ID?.trim(),
    ),
    brave: Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim()),
    serper: Boolean(process.env.SERPER_API_KEY?.trim()),
    searxng: Boolean(searxngUrl),
  };

  return Object.entries(configured).map(([name, isConfigured]) => {
    const unreachable =
      name === "searxng" &&
      searxngUrl &&
      isUnreachableWhenDeployed(searxngUrl)
        ? `${searxngUrl} is a local address and cannot be reached from a deployment.`
        : undefined;

    const reason = disabledProviders.get(name) ?? unreachable;

    return {
      name,
      configured: isConfigured,
      disabled: Boolean(reason),
      ...(reason ? { reason } : {}),
    };
  });
}

/* For tests, which need each case to start from a known state. */
export function resetSearchHealth(): void {
  disabledProviders.clear();
}
