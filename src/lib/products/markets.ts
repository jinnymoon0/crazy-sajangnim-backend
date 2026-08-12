import type { Currency, Market } from "@/types/product";

/*
 * What each storefront prices in.
 *
 * This was written four times as `market === "KR" ? "KRW" : "USD"`, and
 * adding Japan made every one of them wrong in the same way: yen
 * amounts stamped as dollars, so a ¥75,250 coat would have shown as
 * $75,250 and every conversion under it would have been nonsense.
 *
 * A ternary answers a two-way question. There are three storefronts, so
 * it is a lookup — and a fourth cannot be added without this file
 * refusing to compile until it is told what the money is.
 */
export const CURRENCY_BY_MARKET: Record<Market, Currency> = {
  US: "USD",
  KR: "KRW",
  JP: "JPY",
};

/*
 * Every storefront, derived rather than listed.
 *
 * A hand-written ["US", "KR"] is a valid Market[] however many markets
 * exist, so the compiler cannot object when one is missing — which is
 * how the admin's brand breakdown quietly omitted Japan after the type
 * gained it. Taken from the map above, it cannot fall behind.
 */
export const ALL_MARKETS = Object.keys(CURRENCY_BY_MARKET) as Market[];
