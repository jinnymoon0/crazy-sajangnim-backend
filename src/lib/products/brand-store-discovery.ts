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
  JPY: "JP",
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

  const domains: string[] = [];

  for (const base of bases) {
    if (base.length < 3) {
      continue;
    }

    /*
     * Ordered by how likely each is to be the real shop, because the
     * first candidate that checks out wins. The regional subdomains
     * matter for labels whose home site sells in a third currency —
     * BAPE trades in yen at bape.com but in dollars at us.bape.com.
     */
    domains.push(
      `${base}.com`,
      `${base}.jp`,
      `${base}.co.jp`,
      `${base}.kr`,
      `${base}.co.kr`,
      `us.${base}.com`,
      `jp.${base}.com`,
      `kr.${base}.com`,
      `shop.${base}.com`,
      `store.${base}.com`,
      `${base}.store`,
      `${base}.shop`,
      `shop${base}.com`,
    );

    /*
     * "<brand>official.com" is deliberately left out. It is the domain
     * counterfeit shops reach for, and it produced only false matches:
     * a Pakistani bag brand for HIBISCUS, and a Wu-Tang merch store for
     * SUPREME.
     */
  }

  return Array.from(new Set(domains)).slice(0, 30);
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
 * Names as loosely as the shops write them: "NANAMICA 2026 SS" and
 * "Aimé Leon Dore" both have to match the brand they belong to.
 */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/*
 * Whether a Shopify product's vendor is the brand whose shop we are
 * reading. Stores that carry other labels alongside their own list them
 * by vendor, so this is what keeps a Nike jacket sold at Kith from
 * being filed under KITH.
 */
export function isBrandVendor(
  vendor: string | undefined,
  englishName: string,
): boolean {
  return normalizeName(vendor ?? "").includes(normalizeName(englishName));
}

/*
 * A brand's own shop sells that brand. Checking the vendor on its
 * products is what separates a real store from one that merely owns a
 * matching address — supremeofficial.com prices in dollars and says
 * "supreme" throughout, but every product on it is Wu-Tang merch.
 *
 * It also keeps retailers out. Kith sells mostly Nike, and trusting it
 * as the KITH store would file those products under the wrong brand.
 */
async function sellsBrand(
  domain: string,
  englishName: string,
): Promise<boolean> {
  const body = await fetchHtml(`https://${domain}/products.json?limit=50`);

  if (!body) {
    return false;
  }

  let products: { vendor?: string }[];

  try {
    products = (JSON.parse(body) as { products?: { vendor?: string }[] })
      .products ?? [];
  } catch {
    return false;
  }

  if (products.length === 0) {
    return false;
  }

  const matching = products.filter((product) =>
    isBrandVendor(product.vendor, englishName),
  ).length;

  return matching >= products.length / 2;
}

/*
 * Decide whether a reachable page is a shop we can read, and which
 * storefront its prices belong to.
 */
async function evaluate(
  domain: string,
  html: string,
  englishName: string,
): Promise<DiscoveredStore | null> {
  const platform = detectPlatform(html);

  if (!platform) {
    return null;
  }

  /*
   * Short brand names often collide with an unrelated business that
   * happens to own the address, so the shop has to price in a currency
   * one of the storefronts actually uses. Cafe24 is a Korean platform
   * and prices in won.
   */
  if (platform === "cafe24") {
    return { domain, platform, market: "KR" };
  }

  if (!(await sellsBrand(domain, englishName))) {
    console.log(
      `Skipping ${domain} for ${englishName}: its products are other brands`,
    );

    return null;
  }

  const currency = await shopCurrency(domain);
  const market = currency ? CURRENCY_MARKETS[currency] : undefined;

  if (!market) {
    console.log(
      `Skipping ${domain} for ${englishName}: prices in ${currency ?? "an unknown currency"}`,
    );

    return null;
  }

  return { domain, platform, market };
}

/*
 * Look for a brand's own shop. Returns the first candidate that names
 * the brand, runs on a platform we can read, and prices in a currency
 * one of the storefronts uses.
 */
export async function discoverBrandStore(
  englishName: string,
  slug: string,
): Promise<DiscoveredStore | null> {
  const domains = candidateDomains(englishName, slug);

  /*
   * Probing two dozen domains one at a time takes longer than a request
   * should, so check them in batches. Each batch is settled before the
   * next is fetched, which keeps the earlier, more likely candidates
   * winning without giving up on the rest when one is rejected.
   */
  const BATCH_SIZE = 6;

  for (let start = 0; start < domains.length; start += BATCH_SIZE) {
    const pages = await Promise.all(
      domains.slice(start, start + BATCH_SIZE).map(async (domain) => ({
        domain,
        html: await fetchHtml(`https://${domain}/`),
      })),
    );

    for (const { domain, html } of pages) {
      if (!html || !mentionsBrand(html, englishName)) {
        continue;
      }

      const store = await evaluate(domain, html, englishName);

      if (store) {
        console.log(
          `Discovered ${store.platform} store for ${englishName}: ${domain} (${store.market})`,
        );

        return store;
      }
    }
  }

  return null;
}
