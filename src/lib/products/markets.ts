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
