/*
 * The placements that used to go wrong, plus the ones the rule order
 * is there to protect.
 *
 *   npx tsx scripts/check-category-rules.ts
 */

import { inferCategory } from "../src/lib/products/infer-category";

const CASES: Array<[string, string]> = [
  // "shirt" hides inside both of these.
  ["Lemaire Boxy Short Sleeve Heavy Jersey T-Shirt - Pearl", "t-shirts"],
  ["Adidas Trefoil Sweatshirt", "sweatshirts"],
  ["Adidas Wales Bonner Track Hoodie", "sweatshirts"],
  ["Nike Sportswear Club Crewneck", "sweatshirts"],
  ["MEN'S SHIRT PQ-B012-S26 (BLACK)", "shirts"],
  ["Crest Piqué Polo", "shirts"],
  ["Button Down Wind Shirt", "shirts"],

  // "dress" hides inside a dress shirt.
  ["Thom Browne Oxford Dress Shirt", "shirts"],
  ["Lemaire Column Dress - Black", "dresses"],
  ["Needles Poly Double Cloth S.L. Pencil Skirt", "skirts"],

  // "pant" hides inside "sweatpant"; "sweat" must not pull it away.
  ["Nike Tech Fleece Sweatpant", "pants"],
  ["Adidas Firebird Track Pant", "pants"],
  ["Cargo Shorts Olive", "shorts"],

  ["Stacked Logo Hat", "hats"],
  ["New Era Bucket Hat", "hats"],
  ["Carhartt WIP Beanie", "hats"],
  ["Adidas Y-3 Graphic Crew Socks - Black", "accessories"],
  ["Comme des Garçons Leather Wallet", "accessories"],

  ["Air Jordan 3 Retro OG Sneaker", "shoes"],
  ["Stone Island Lightweight Hooded Down Jacket", "outerwear"],
  ["Auralee Wool Cashmere Knit", "knitwear"],
  ["Porter Yoshida Tote Bag", "bags"],

  // Korean titles.
  ["(W) 시티 스트림 실켓 티셔츠 - 블랙", "t-shirts"],
  ["컷오프 리플 셔츠 - 블랙", "shirts"],
  ["오버핏 맨투맨 - 그레이", "sweatshirts"],
  ["와이드 데님 팬츠", "pants"],
  ["플리츠 스커트 - 네이비", "skirts"],
  ["볼캡 - 블랙", "hats"],

  // Korean listings that name only the silhouette.
  ["삼바 OG - 베이지:다크브라운 / JR2660", "shoes"],
  ["핸드볼 스페지알 - 블랙:핑크 / IE5897", "shoes"],
  ["스피드캣 OG - 화이트", "shoes"],

  // Tank tops and the like had nowhere to go.
  ["Lemaire Seamless Rib Tank Top - Misty Mauve", "tops"],
  ["SATIN LACE CAMISOLE_ BLACK", "tops"],
  ["SOFT DRAPED TWIST SLEEVELESS TOP_ CHARCOAL", "tops"],
  // A track top is a zip jacket, not a tank.
  ["Adidas Firebird Track Top", "outerwear"],

  // Nothing in the title says what it is.
  ["Unisphere Wool Blanket", "etc"],
];

let failed = 0;

for (const [name, expected] of CASES) {
  const actual = inferCategory(name);

  if (actual !== expected) {
    failed += 1;

    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${expected}, got ${actual}`);
  }
}

console.log(
  failed === 0
    ? `All ${CASES.length} placements correct.`
    : `${failed} of ${CASES.length} wrong.`,
);

process.exit(failed === 0 ? 0 : 1);
