/*
 * What stockist discovery finds for a brand, and which shops the
 * collector would read as a result.
 *
 *   npx tsx scripts/verify-retailer-discovery.ts "STONE ISLAND"
 */

import { discoverRetailers } from "../src/lib/products/retailer-discovery";
import { getRetailers } from "../src/lib/products/retailer-repository";
import { searchProviderName } from "../src/lib/search/web-search";

async function main() {
  console.log(`search provider: ${searchProviderName()}`);

  const stored = await getRetailers("shopify");

  console.log(`\nshops the collector reads now (${stored.length}):`);

  for (const retailer of stored) {
    console.log(
      `  ${retailer.domain} (${retailer.market}, ${retailer.defaultGender})`,
    );
  }

  const names = process.argv.slice(2);

  for (const name of names.length > 0 ? names : ["STONE ISLAND"]) {
    console.log(`\nlooking for shops that stock ${name}...`);

    const found = await discoverRetailers(name.toUpperCase());

    if (found.length === 0) {
      console.log("  none found");

      continue;
    }

    for (const retailer of found) {
      console.log(
        `  ${retailer.domain} — ${retailer.platform}, ${retailer.market}`,
      );
    }
  }
}

main();
