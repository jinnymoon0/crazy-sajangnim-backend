import { searchSearxng } from "@/lib/search/searxng";

export interface WebResult {
  title: string;
  url: string;
}

/*
 * Ask the web a question, through whichever provider is configured.
 *
 * SearXNG first, because it is what the brand lookup already uses. It
 * runs on localhost, though, so a deployed copy of this service cannot
 * reach it — hence the hosted fallbacks, either of which is a key in
 * the environment away from working.
 *
 * Returns an empty list when nothing is configured or reachable.
 * Callers treat that as "found no shops", never as an error: brand
 * discovery is an improvement on top of the collectors, not something
 * they depend on.
 */
export async function searchWeb(query: string): Promise<WebResult[]> {
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
