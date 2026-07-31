import { DIRECT_SOURCE_USER_AGENT } from "@/lib/products/sources/shared";
import type { Market } from "@/types/product";

export type StorePlatform = "cafe24" | "shopify";

export interface DiscoveredStore {
  domain: string;
  platform: StorePlatform;
  market: Market;
}

const CURRENCY_MARKETS: Record<string, Market> = {
  USD: "US",
  KRW: "KR",
};

/*
 * Domains a label is likely to trade under, derived from its name.
 * Korean labels commonly use .kr, so those are tried alongside .com.
 */
function candidateDomains(englishName: string, slug: string): string[] {
  const compact = englishName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  const bases = Array.from(
    new Set([slug, compact, slug.replace(/-/g, "")].filter(Boolean)),
  );

  const suffixes = [".com", ".kr", ".co.kr", ".store", ".shop"];

  const domains: string[] = [];

  for (const base of bases) {
    if (base.length < 3) {
      continue;
    }

    for (const suffix of suffixes) {
      domains.push(`${base}${suffix}`);
    }

    domains.push(`shop${base}.com`, `${base}official.com`);
  }

  return Array.from(new Set(domains)).slice(0, 18);
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": DIRECT_SOURCE_USER_AGENT,
        Accept: "text/html",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

/*
 * A shop only counts when it names the brand somewhere on the page —
 * plenty of short brand names resolve to parked domains or unrelated
 * businesses that happen to own the address.
 */
function mentionsBrand(html: string, englishName: string): boolean {
  const haystack = html.toLowerCase();
  const needle = englishName.toLowerCase();

  if (haystack.includes(needle)) {
    return true;
  }

  const compact = needle.replace(/[^a-z0-9]/g, "");

  return compact.length >= 4 && haystack.replace(/[^a-z0-9]/g, "").includes(compact);
}

function detectPlatform(html: string): StorePlatform | null {
  if (/cdn\.shopify\.com|Shopify\.theme|shopify-features/i.test(html)) {
    return "shopify";
  }

  if (
    /cafe24|echosting\.cafe24|ecimg\.cafe24img|product\/detail\.html\?product_no=/i.test(
      html,
    )
  ) {
    return "cafe24";
  }

  return null;
}

/*
 * What the shop itself charges in. `/meta.json` reports the shop's own
 * currency; `/cart.js` reports the visitor's, which is whatever the
 * shop decides to show the server we happen to be running on, so it is
 * only a fallback. This has to match `/products.json`, which is priced
 * in the shop's currency.
 */
async function shopCurrency(domain: string): Promise<string | null> {
  for (const path of ["/meta.json", "/cart.js"]) {
    const body = await fetchHtml(`https://${domain}${path}`);

    if (!body) {
      continue;
    }

    try {
      const currency = (JSON.parse(body) as { currency?: string }).currency;

      if (typeof currency === "string" && currency.length === 3) {
        return currency;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/*
 * Look for a brand's own shop. Returns the first candidate that both
 * names the brand and runs on a platform we can read.
 */
export async function discoverBrandStore(
  englishName: string,
  slug: string,
): Promise<DiscoveredStore | null> {
  const domains = candidateDomains(englishName, slug);

  /*
   * Probing eighteen domains one at a time takes longer than a request
   * should, so check them in batches while still preferring the
   * earlier, more likely candidates.
   */
  const BATCH_SIZE = 6;
  const reachable: { domain: string; html: string }[] = [];

  for (let start = 0; start < domains.length; start += BATCH_SIZE) {
    const batch = domains.slice(start, start + BATCH_SIZE);

    const pages = await Promise.all(
      batch.map(async (domain) => ({
        domain,
        html: await fetchHtml(`https://${domain}/`),
      })),
    );

    for (const page of pages) {
      if (page.html && mentionsBrand(page.html, englishName)) {
        reachable.push({ domain: page.domain, html: page.html });
      }
    }

    if (reachable.length > 0) {
      break;
    }
  }

  for (const { domain, html } of reachable) {
    const platform = detectPlatform(html);

    if (!platform) {
      continue;
    }

    /*
     * Short brand names often collide with an unrelated business that
     * happens to own the address, so the shop has to price in a
     * currency one of the storefronts actually uses. Cafe24 is a
     * Korean platform and prices in won.
     */
    let market: Market = "KR";

    if (platform === "shopify") {
      const products = await fetchHtml(
        `https://${domain}/products.json?limit=1`,
      );

      if (!products || !products.includes('"products"')) {
        continue;
      }

      const currency = await shopCurrency(domain);

      const resolved = currency ? CURRENCY_MARKETS[currency] : undefined;

      if (!resolved) {
        console.log(
          `Skipping ${domain} for ${englishName}: prices in ${currency ?? "an unknown currency"}`,
        );

        continue;
      }

      market = resolved;
    }

    console.log(
      `Discovered ${platform} store for ${englishName}: ${domain} (${market})`,
    );

    return { domain, platform, market };
  }

  return null;
}
