export interface SearxngResult {
  title: string;
  url: string;
  content?: string;
  thumbnail?: string;
  img_src?: string;
  engine?: string;
  engines?: string[];
  score?: number;
}

interface SearxngResponse {
  query?: string;
  results?: SearxngResult[];
  unresponsive_engines?: Array<[string, string]>;
}

export interface SearxngSearchResponse {
  results: SearxngResult[];
  unresponsiveEngines: Array<[string, string]>;
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;

/*
 * When SearXNG reports several unresponsive upstream engines, those engines are
 * being rate-limited (too many requests / CAPTCHA). Briefly back off so a burst
 * of queries does not push the shared instance further into suspension, which
 * returns degraded, product-less results. The cooldown is shared across
 * concurrent callers and self-clears once engines recover.
 */
const THROTTLE_ENGINE_THRESHOLD = 3;
const THROTTLE_COOLDOWN_MS = 2_000;

let throttledUntil = 0;

function getSearxngUrl(): string {
  const value = process.env.SEARXNG_URL?.trim();

  if (!value) {
    throw new Error("SEARXNG_URL is missing.");
  }

  return value.replace(/\/+$/, "");
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function requestSearxng(
  url: URL,
  timeoutMs: number,
): Promise<SearxngSearchResponse> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "crazy-sajangnim/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `SearXNG request failed with status ${response.status}: ${responseText.slice(0, 200)}`,
    );
  }

  let data: SearxngResponse;

  try {
    data = JSON.parse(
      responseText,
    ) as SearxngResponse;
  } catch {
    throw new Error(
      "SearXNG returned invalid JSON.",
    );
  }

  const results = (
    data.results ?? []
  ).filter((result) => {
    return (
      typeof result.title === "string" &&
      result.title.trim().length > 0 &&
      typeof result.url === "string" &&
      /^https?:\/\//i.test(result.url)
    );
  });

  return {
    results,
    unresponsiveEngines:
      data.unresponsive_engines ?? [],
  };
}

export async function searchSearxng(
  query: string,
  options?: {
    language?: string;
    page?: number;
    /*
     * How long the caller is willing to wait in total. Without it a
     * host that accepts the connection and then says nothing costs
     * MAX_ATTEMPTS x REQUEST_TIMEOUT_MS, which is longer than any
     * caller's own budget.
     */
    budgetMs?: number;
  },
): Promise<SearxngSearchResponse> {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return {
      results: [],
      unresponsiveEngines: [],
    };
  }

  const url = new URL(
    `${getSearxngUrl()}/search`,
  );

  url.searchParams.set("q", normalizedQuery);
  url.searchParams.set("format", "json");
  url.searchParams.set(
    "language",
    options?.language ?? "en-US",
  );
  url.searchParams.set(
    "pageno",
    String(options?.page ?? 1),
  );
  url.searchParams.set("safesearch", "0");

  let lastError: unknown;

  const deadline =
    Date.now() + (options?.budgetMs ?? MAX_ATTEMPTS * REQUEST_TIMEOUT_MS);

  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS;
    attempt += 1
  ) {
    const cooldownRemaining = throttledUntil - Date.now();

    if (cooldownRemaining > 0) {
      await wait(cooldownRemaining);
    }

    /* Nothing left to spend: stop rather than start a doomed attempt. */
    const left = deadline - Date.now();

    if (left <= 0) {
      break;
    }

    try {
      const result = await requestSearxng(
        url,
        Math.min(REQUEST_TIMEOUT_MS, left),
      );

      if (
        result.unresponsiveEngines.length >= THROTTLE_ENGINE_THRESHOLD
      ) {
        throttledUntil = Date.now() + THROTTLE_COOLDOWN_MS;
      }

      return result;
    } catch (error) {
      lastError = error;

      console.warn(
        `SearXNG attempt ${attempt} failed:`,
        error,
      );

      if (attempt < MAX_ATTEMPTS) {
        await wait(1_000);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("SearXNG search failed.");
}
