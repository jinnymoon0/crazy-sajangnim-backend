/*
 * Titles that must not be attributed to a brand just because the brand's
 * name appears in them. ON is a real brand and also the second half of
 * "Slip-On", which filed Easymoc and Vans shoes under it.
 *
 *   npx tsx scripts/check-brand-rules.ts
 */

import { BRANDS } from "../src/constants/brands";
import { inferBrand } from "../src/lib/products/infer-brand";
import { setActiveBrands } from "../src/lib/products/brand-registry";

/*
 * Track ON for the duration of the check. That is the whole point: the
 * slip-ons must stay unattributed even while ON is a brand being
 * collected, because the bug was a title matching a tracked name.
 */
setActiveBrands([
  ...BRANDS.map((brand) => ({
    slug: brand.slug,
    englishName: brand.englishName,
    koreanName: brand.koreanName,
    aliases: [...brand.aliases],
    isActive: true,
    addedBy: "seed",
    createdAt: null,
  })),
  {
    slug: "on",
    englishName: "ON",
    koreanName: null,
    aliases: ["ON", "ON RUNNING"],
    isActive: true,
    addedBy: "test",
    createdAt: null,
  },
]);

interface Case {
  text: string;
  expected: string | null;
  fromBrandField?: boolean;
}

const CASES: Case[] = [
  /* The words that caused it. None of these are the brand ON. */
  { text: "Easymoc Slip-On in Chocolate Grizzly Roughout", expected: null },
  { text: "Easymoc Slip-On in Toast Suede", expected: null },
  { text: "Vans Slip-On Reissue 98 LX Sneakers", expected: null },
  { text: "FOOT CAST///SLIP ON BLACK", expected: null },
  { text: "FOOT CAST///SLIP ON LATURAL", expected: null },
  { text: "(W) DESERT NOMAD SPECKLED HAIR ON", expected: null },
  { text: "Pull On Trouser", expected: null },
  { text: "New Balance 990v6", expected: null },

  /* A shop naming the brand itself is still believed. */
  { text: "On", expected: "on", fromBrandField: true },
  { text: "On Running", expected: "on", fromBrandField: true },

  /*
   * Ordinary names keep matching in a title, as before — including the
   * short ones, which are short without being words.
   */
  { text: "NEEDLES Track Pant Poly Smooth", expected: "needles" },
  { text: "니들스 트랙 팬츠", expected: "needles" },
  { text: "CDG Play Heart Tee", expected: "comme-des-garcons" },
  { text: "ALD Wool Cardigan", expected: "aime-leon-dore" },
  { text: "나이키 에어포스 1", expected: "nike" },
];

let failed = 0;

for (const testCase of CASES) {
  const actual =
    inferBrand(testCase.text, {
      fromBrandField: testCase.fromBrandField,
    })?.slug ?? null;

  const ok = actual === testCase.expected;

  if (!ok) {
    failed += 1;
  }

  const where = testCase.fromBrandField ? "brand" : "title";

  console.log(
    `${ok ? "ok  " : "FAIL"} ${where.padEnd(5)} ${String(actual).padEnd(16)} ${testCase.text}`,
  );
}

console.log(
  failed === 0
    ? `\n${CASES.length} cases passed`
    : `\n${failed} of ${CASES.length} failed`,
);

process.exit(failed === 0 ? 0 : 1);
