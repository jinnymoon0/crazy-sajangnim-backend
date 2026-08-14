import type { Market, Product } from "@/types/product";

export const DIRECT_SOURCE_USER_AGENT =
  process.env.COLLECTOR_USER_AGENT ??
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/*
 * Gender lives in gender.ts now. This file kept a second copy of the
 * word lists, and the two drifted: this one had the word boundaries
 * right but could not see a garment inside a compound, so MINISKIRT and
 * sailorskirt were not skirts and went to whichever segment the crawl
 * defaulted to — which for a brand store is UNISEX, meaning both.
 */
export { resolveGender } from "@/lib/products/gender";

export function isReasonablePrice(price: number, market: Market): boolean {
  if (!Number.isFinite(price)) {
    return false;
  }

  return market === "KR"
    ? price >= 10_000 && price <= 20_000_000
    : price >= 20 && price <= 50_000;
}

export function parseUsdAmount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/([\d,]+(?:\.\d{1,2})?)/);

  if (!match) {
    return null;
  }

  const parsed = Number.parseFloat(match[1].replace(/,/g, ""));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function dedupeProducts(products: Product[]): Product[] {
  return Array.from(
    new Map(
      products.map((product) => [
        [product.sourceUrl, product.productName, product.salePrice].join("|"),
        product,
      ]),
    ).values(),
  );
}

export async function fetchWithTimeout(
  url: string,
  init?: {
    accept?: string;
    timeoutMs?: number;
  },
): Promise<Response> {
  return fetch(url, {
    headers: {
      Accept: init?.accept ?? "application/json",
      "User-Agent": DIRECT_SOURCE_USER_AGENT,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(init?.timeoutMs ?? 15_000),
  });
}
