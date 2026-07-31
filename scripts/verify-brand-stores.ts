/*
 * Check that a brand's own shop is found and can be read for sale
 * items, for both platforms we support.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/verify-brand-stores.ts
 */

import { discoverBrandStore } from "../src/lib/products/brand-store-discovery";
import type { BrandRecord } from "../src/lib/products/brand-repository";
import { collectBrandStoreProducts } from "../src/lib/products/sources/brand-stores";
import type { Market } from "../src/types/product";

async function main() {
  const NAMES = process.argv.slice(2);

  const brands: BrandRecord[] = [];

  for (const name of NAMES.length > 0 ? NAMES : ["NUUANU", "KLEESIER"]) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    const store = await discoverBrandStore(name.toUpperCase(), slug);

    console.log(
      `${name}: ${store ? `${store.domain} (${store.platform}, ${store.market})` : "no shop found"}`,
    );

    if (!store) {
      continue;
    }

    brands.push({
      slug,
      englishName: name.toUpperCase(),
      koreanName: null,
      aliases: [name.toUpperCase()],
      isActive: true,
      addedBy: null,
      createdAt: null,
      storeDomain: store.domain,
      storePlatform: store.platform,
      storeMarket: store.market,
    });
  }

  for (const market of ["US", "KR"] as Market[]) {
    const products = await collectBrandStoreProducts(market, brands);

    console.log(`\n${market}: ${products.length} sale items`);

    for (const product of products.slice(0, 4)) {
      console.log(
        `  ${product.brandName} — ${product.productName} — ${product.originalPrice} -> ${product.salePrice} (${product.discountPercentage}% off, ${product.gender}) ${product.sourceUrl}`,
      );
    }
  }
}

main();
