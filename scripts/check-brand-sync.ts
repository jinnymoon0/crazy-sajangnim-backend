/*
 * Where the catalog and the brand list disagree, read against whatever
 * database the environment points at.
 *
 *   npx tsx scripts/check-brand-sync.ts
 */

import { findBrandDrift } from "../src/lib/products/brand-sync";

async function main() {
  const drift = await findBrandDrift();

  console.log(
    `brands tracked: ${drift.trackedBrands}   brands seen in the catalog: ${drift.catalogBrands}`,
  );

  if (drift.orphaned.length === 0) {
    console.log("\nnothing adrift: every product belongs to a tracked brand");
  } else {
    console.log(
      `\nfiled under a brand that is not tracked (${drift.orphaned.length}):`,
    );

    for (const entry of drift.orphaned) {
      console.log(`   ${entry.slug.padEnd(24)} ${entry.products} products`);
    }
  }

  if (drift.empty.length > 0) {
    console.log(`\ntracked but with nothing collected (${drift.empty.length}):`);
    console.log(`   ${drift.empty.join(", ")}`);
  }
}

main();
