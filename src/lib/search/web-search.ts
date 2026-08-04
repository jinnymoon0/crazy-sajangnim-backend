import { searchSearxng } from "@/lib/search/searxng";

export interface WebResult {
  title: string;
  url: string;
}

/*
 * Ask the web a question, through whichever provider is configured.
 *
 * Google's programmable search first: a hundred queries a day, free,
 * no card, and the project is already there from the sign-in setup.
 * Brands are added by hand a few at a time, so that allowance is not
 * the constraint.
 *
 * Then Brave or Serper for anyone who wants more, then SearXNG, which
 * is what the brand lookup already uses — though it runs on localhost,
 * so a deployed copy of this service cannot reach it.
 *
 * Returns an empty list when nothing is configured or reachable.
 * Callers treat that as "found no shops", never as an error: brand
 * discovery is an improvement on top of the collectors, not something
 * they depend on.
 */
export async function searchWeb(query: string): Promise<WebResult[]> {
  const googleKey = process.env.GOOGLE_SEARCH_API_KEY?.trim();
  const googleEngine = process.env.GOOGLE_SEARCH_ENGINE_ID?.trim();

  if (googleKey && googleEngine) {
    const results = await searchGoogle(query, googleKey, googleEngine);

    if (results.length > 0) {
      return results;
    }
  }

  const brave = process.env.BRAVE_SEARCH_API_KEY?.trim();

  if (brave) {
    const results = await searchBrave(query, brave);

    if (results.length > 0) {
      return results;
    }
  }

  const serper = process.env.SERPER_API_KEY?.trim();

  if (serper) {
    const results = await searchSerper(query, serper);

    if (results.length > 0) {
      return results;
    }
  }

  try {
    const response = await searchSearxng(query);

    return response.results.map((result) => ({
      title: result.title,
      url: result.url,
    }));
  } catch (error) {
    console.error(`Web search for ${query} found nothing:`, error);

    return [];
  }
}

async function searchGoogle(
  query: string,
  key: string,
  engineId: string,
): Promise<WebResult[]> {
  try {
    const url = new URL("https://www.googleapis.com/customsearch/v1");

    url.searchParams.set("key", key);
    url.searchParams.set("cx", engineId);
    url.searchParams.set("q", query);
    url.searchParams.set("num", "10");

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      /*
       * 429 is the daily hundred spent. Nothing is wrong with the
       * setup, so say which it is rather than leaving a bare status.
       */
      console.error(
        response.status === 429
          ? "Google search: the free daily allowance is spent."
          : `Google search returned ${response.status}`,
      );

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
): Promise<WebResult[]> {
  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20`,
      {
        headers: { Accept: "application/json", "X-Subscription-Token": key },
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!response.ok) {
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
): Promise<WebResult[]> {
  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 20 }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
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
    process.env.GOOGLE_SEARCH_ENGINE_ID?.trim()
  ) {
    return "google";
  }

  if (process.env.BRAVE_SEARCH_API_KEY?.trim()) {
    return "brave";
  }

  if (process.env.SERPER_API_KEY?.trim()) {
    return "serper";
  }

  if (process.env.SEARXNG_URL?.trim()) {
    return "searxng";
  }

  return "none";
}
