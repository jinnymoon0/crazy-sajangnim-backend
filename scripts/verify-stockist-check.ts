/*
 * The gate that decides whether a shop is added: it must show the brand
 * in its own catalogue, run on a readable platform, and price in a
 * currency one of the storefronts uses.
 *
 *   npx tsx scripts/verify-stockist-check.ts
 */

import { verifyStockist } from "../src/lib/products/retailer-discovery";

const CASES: Array<[string, string, string]> = [
  ["svrn.com", "AURALEE", "Shopify stockist that carries it"],
  ["notre-shop.com", "SUPREME", "Shopify shop that does not carry it"],
  ["slamjam.com", "STONE ISLAND", "carries it, but prices in euros"],
  ["nuuanu.kr", "SKIRT", "cafe24 shop, a word its catalogue answers"],
  ["wikipedia.org", "NEEDLES", "not a shop at all"],
];

// One at a time with a pause: shops throttle a caller that asks fast,
// and a throttled shop must not be read as one lacking the brand.
const PAUSE_MS = 4000;

async function main() {
  for (const [domain, brand, why] of CASES) {
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

    const result = await verifyStockist(domain, brand);

    console.log(
      `  ${domain} ${brand} — ${why}\n    -> ${
        result
          ? `ADDED as ${result.platform}, ${result.market}`
          : "refused"
      }`,
    );
  }
}

main();
