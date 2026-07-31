import { readFile } from "node:fs/promises";
import * as cheerio from "cheerio";

import { parseRetailerProducts } from "../src/lib/products/retailers";

async function main(): Promise<void> {
  const tests = [
    {
      file: "retailer-samples/lyst-auralee-women.html",
      pageUrl: "https://www.lyst.com/shop/auralee-clothing/",
      market: "US" as const,
      gender: "WOMEN" as const,
      brandSlug: "auralee" as const,
      brandName: "AURALEE",
    },
    {
      file: "retailer-samples/lyst-lemaire-women.html",
      pageUrl: "https://www.lyst.com/shop/lemaire-designer-clothing/",
      market: "US" as const,
      gender: "WOMEN" as const,
      brandSlug: "lemaire" as const,
      brandName: "LEMAIRE",
    },
    {
      file: "retailer-samples/eightdivision-needles.html",
      pageUrl: "https://8division.com/category/needles/207/",
      market: "KR" as const,
      gender: "MEN" as const,
      brandSlug: "needles" as const,
      brandName: "NEEDLES",
    },
    {
      file: "retailer-samples/sculpstore-needles.html",
      pageUrl: "https://sculpstore.com/category/needles/189/",
      market: "KR" as const,
      gender: "MEN" as const,
      brandSlug: "needles" as const,
      brandName: "NEEDLES",
    },
  ];

  for (const test of tests) {
    const html = await readFile(test.file, "utf8");

    const $ = cheerio.load(html);

    const products = parseRetailerProducts({
      $,
      html,
      pageUrl: test.pageUrl,
      market: test.market,
      requestedGender: test.gender,
      brandSlug: test.brandSlug,
      brandName: test.brandName,
      maxProducts: 200,
    });

    console.log(`\n${test.file}: ${products.length} sale products`);

    for (const product of products.slice(0, 5)) {
      console.log(
        [
          product.productName,
          product.originalPrice,
          product.salePrice,
          product.sourceUrl,
        ].join(" | "),
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
