/*
 * Check what END. contributes to each storefront.
 *
 *   npx tsx scripts/verify-end-clothing.ts
 */

import { collectEndClothingProducts } from "../src/lib/products/sources/end-clothing";
import type { Market } from "../src/types/product";

async function main() {
  for (const market of ["US", "KR"] as Market[]) {
    const products = await collectEndClothingProducts(market);

    const byBrand = new Map<string, number>();
    const byGender = new Map<string, number>();

    for (const product of products) {
      byBrand.set(product.brandName, (byBrand.get(product.brandName) ?? 0) + 1);
      byGender.set(product.gender, (byGender.get(product.gender) ?? 0) + 1);
    }

    console.log(`\n${market}: ${products.length} sale items`);
    console.log(`  gender: ${JSON.stringify(Object.fromEntries(byGender))}`);
    console.log(
      `  brands: ${[...byBrand.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `${name} ${count}`)
        .join(", ")}`,
    );

    for (const product of products.slice(0, 3)) {
      console.log(
        `    ${product.brandName} — ${product.productName} — ${product.originalPrice} -> ${product.salePrice} (${product.discountPercentage}% off, ${product.gender}, ${product.categorySlug})`,
      );
      console.log(`      ${product.sourceUrl}`);
    }
  }
}

main();
