import { isBrandVendor } from "@/lib/products/brand-store-discovery";
import { KNOWN_STOCKISTS } from "@/lib/products/known-stockists";
import { searchWeb } from "@/lib/search/web-search";
import { DIRECT_SOURCE_USER_AGENT } from "@/lib/products/sources/shared";
import type { Market } from "@/types/product";

export type RetailerPlatform = "shopify" | "cafe24";

export interface DiscoveredRetailer {
  domain: string;
  platform: RetailerPlatform;
  market: Market;
}

const CURRENCY_MARKETS: Record<string, Market> = {
  USD: "US",
  KRW: "KR",
};

/*
 * Shops we already read another way, marketplaces that would drown the
 * catalogue in resale listings, and the places search results come from
 * rather than sell from.
 */
const NEVER: string[] = [
  "garmentory.com",
  "hbx.com",
  "endclothing.com",
  "musinsa.com",
  "29cm.co.kr",
  "okmall.com",
  "ssense.com",
  "farfetch.com",
  "nordstrom.com",
  "amazon.",
  "ebay.",
  "etsy.com",
  "poshmark.com",
  "grailed.com",
  "vestiairecollective.com",
  "depop.com",
  "aliexpress.",
  "temu.com",
  "instagram.com",
  "facebook.com",
  "pinterest.",
  "youtube.com",
  "tiktok.com",
  "reddit.com",
  "wikipedia.org",
  "google.",
  "naver.com",
  "daum.net",
  "tistory.com",
  "blogspot.",
  "medium.com",
];

const MAX_CANDIDATES = 14;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isWorthProbing(host: string): boolean {
  return !NEVER.some((skip) => host.includes(skip));
}

/*
 * A shop that will not answer is not a shop that lacks the brand.
 * Shopify throttles a caller that asks too often, and reading a 429 as
 * "does not stock it" would quietly refuse real stockists — so say
 * which happened rather than returning nothing either way.
 */
type Fetched =
  | { kind: "body"; text: string }
  | { kind: "missing" }
  | { kind: "unavailable" };

async function fetchText(url: string, attempt = 1): Promise<Fetched> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": DIRECT_SOURCE_USER_AGENT,
        Accept: "application/json,text/html",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      return { kind: "body", text: await response.text() };
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));

        return fetchText(url, attempt + 1);
      }

      console.log(`${url} is throttling us (${response.status})`);

      return { kind: "unavailable" };
    }

    return { kind: "missing" };
  } catch {
    return { kind: "unavailable" };
  }
}

/*
 * What the shop itself charges in, from its own record rather than the
 * visitor's — a shop shows a Korean server won whatever it banks in.
 */
async function shopCurrency(domain: string): Promise<string | null> {
  const result = await fetchText(`https://${domain}/meta.json`);

  if (result.kind !== "body") {
    return null;
  }

  try {
    const currency = (JSON.parse(result.text) as { currency?: string })
      .currency;

    return typeof currency === "string" && currency.length === 3
      ? currency
      : null;
  } catch {
    return null;
  }
}

/*
 * Does this shop really stock the brand, and can we read it?
 *
 * A search result saying so is not enough — search engines return
 * listicles, resale, and shops that stopped carrying it years ago. The
 * shop has to answer for itself, in a currency one of the storefronts
 * uses.
 */
const CATALOGUE_PAGES = 4;

/*
 * Ask a Shopify shop about the brand, the way the cafe24 branch below
 * already asks a cafe24 one.
 *
 * Paging products.json hunts for the brand among whatever the shop
 * listed most recently, which for a large multi-brand retailer is the
 * wrong end of a catalogue tens of thousands of items long. Haven and
 * Nepenthes NY both genuinely stock Needles and both were refused, and
 * the paging drew 429s from two other shops on the way — a check that
 * hammers a shop and then gets the answer wrong.
 *
 * Predictive search answers the same question in one request. A yes is
 * conclusive; anything else falls through to the paging below rather
 * than refusing, because not every Shopify theme exposes this.
 */
async function shopifySearchCarries(
  domain: string,
  englishName: string,
): Promise<boolean> {
  const response = await fetchText(
    `https://${domain}/search/suggest.json` +
      `?q=${encodeURIComponent(englishName)}` +
      `&resources[type]=product&resources[limit]=10`,
  );

  if (response.kind !== "body") {
    return false;
  }

  try {
    const body = JSON.parse(response.text) as {
      resources?: { results?: { products?: { vendor?: string }[] } };
    };

    return (body.resources?.results?.products ?? []).some((product) =>
      isBrandVendor(product.vendor, englishName),
    );
  } catch {
    return false;
  }
}

export async function verifyStockist(
  domain: string,
  englishName: string,
): Promise<DiscoveredRetailer | null> {
  const first = await fetchText(`https://${domain}/products.json?limit=250`);

  if (first.kind === "unavailable") {
    return null;
  }

  if (first.kind === "body") {
    /*
     * Several pages, not one. A shop's first 250 products are whatever
     * it listed most recently — svrn.com genuinely stocks Needles, but
     * not on page one, and stopping there would refuse a real stockist.
     */
    let carries = await shopifySearchCarries(domain, englishName);
    let sawAnything = carries;

    for (let page = 1; !carries && page <= CATALOGUE_PAGES; page += 1) {
      const fetched =
        page === 1
          ? first
          : await fetchText(
              `https://${domain}/products.json?limit=250&page=${page}`,
            );

      if (fetched.kind !== "body") {
        break;
      }

      let products: { vendor?: string }[] = [];

      try {
        products =
          (JSON.parse(fetched.text) as { products?: { vendor?: string }[] })
            .products ?? [];
      } catch {
        break;
      }

      if (products.length === 0) {
        break;
      }

      sawAnything = true;

      if (products.some((product) => isBrandVendor(product.vendor, englishName))) {
        carries = true;

        break;
      }

      if (products.length < 250) {
        break;
      }
    }

    if (!sawAnything || !carries) {
      return null;
    }

    const currency = await shopCurrency(domain);
    const market = currency ? CURRENCY_MARKETS[currency] : undefined;

    if (!market) {
      console.log(
        `Skipping ${domain}: prices in ${currency ?? "an unknown currency"}`,
      );

      return null;
    }

    return { domain, platform: "shopify", market };
  }

  /*
   * Cafe24 has no vendor field, so ask its own search for the brand and
   * require it to come back with products.
   */
  const search = await fetchText(
    `https://${domain}/product/search.html?keyword=${encodeURIComponent(englishName)}`,
  );

  if (search.kind !== "body") {
    return null;
  }

  if (!/cafe24|ecimg\.cafe24img/i.test(search.text)) {
    return null;
  }

  /*
   * Both link shapes cafe24 shops use. Only matching the query-string
   * form missed every shop on the tidier /product/<slug>/<id>/ URLs,
   * which is most of them — the collector's own selector accepts both.
   */
  const hasProducts =
    /product\/detail\.html\?product_no=/i.test(search.text) ||
    /href="\/product\/(?!list\.html|search\.html)[^"]{3,}/i.test(search.text);

  if (!hasProducts) {
    return null;
  }

  return { domain, platform: "cafe24", market: "KR" };
}

/*
 * Find shops that stock a brand and that we can actually read.
 *
 * Candidates only propose; each has to prove it carries the brand, runs
 * on a platform with a public catalogue, and prices in dollars or won.
 * Everything else is dropped.
 *
 * Candidates come from two places, and the order is the point. Search
 * goes first when a provider is configured, because it is the only one
 * that can turn up a shop nobody thought to list. The curated stockists
 * follow, and they run whether search does or not.
 *
 * This used to return nothing at all without a search provider, which
 * made every brand added since the Google key stopped working depend on
 * a credential to find any stock beyond its own website. A key that
 * expires, 403s, or bills should degrade what discovery finds, not
 * switch it off.
 */
export async function discoverRetailers(
  englishName: string,
  koreanName?: string | null,
): Promise<DiscoveredRetailer[]> {
  const queries = [
    `"${englishName}" buy online store`,
    `"${englishName}" sale shop`,
    koreanName ? `"${koreanName}" 구매` : null,
  ].filter((query): query is string => Boolean(query));

  const hosts = new Set<string>();

  for (const query of queries) {
    for (const result of await searchWeb(query)) {
      const host = hostOf(result.url);

      if (host && isWorthProbing(host)) {
        hosts.add(host);
      }

      if (hosts.size >= MAX_CANDIDATES) {
        break;
      }
    }

    if (hosts.size >= MAX_CANDIDATES) {
      break;
    }
  }

  /*
   * Topped up rather than replaced. Search results keep the places they
   * earned at the front of the queue, and the list fills whatever room
   * is left — so a configured provider still decides most of what gets
   * probed, and an absent one no longer decides nothing does.
   */
  for (const domain of KNOWN_STOCKISTS) {
    if (hosts.size >= MAX_CANDIDATES) {
      break;
    }

    if (isWorthProbing(domain)) {
      hosts.add(domain);
    }
  }

  if (hosts.size === 0) {
    return [];
  }

  const found: DiscoveredRetailer[] = [];

  // A few at a time; these are other people's shops.
  const candidates = Array.from(hosts);

  for (let start = 0; start < candidates.length; start += 4) {
    const batch = candidates.slice(start, start + 4);

    const checked = await Promise.all(
      batch.map((domain) => verifyStockist(domain, englishName)),
    );

    for (const retailer of checked) {
      if (retailer) {
        console.log(
          `${englishName} is stocked at ${retailer.domain} (${retailer.platform}, ${retailer.market})`,
        );

        found.push(retailer);
      }
    }
  }

  return found;
}
