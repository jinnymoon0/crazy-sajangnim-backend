import {
  inferBrand,
  matchesExpectedBrand,
} from "../src/lib/products/infer-brand";

const cases = [
  {
    text: "DKNY Women's Logo T-Shirt",
    expected: null,
  },
  {
    text: "DKNY Sewing Needles Set",
    expected: null,
  },
  {
    text: "Needles Track Jacket Purple",
    expected: "needles",
  },
  {
    text: "니들스 H.D. Track Pant",
    expected: "needles",
  },
  {
    text: "LEMAIRE Croissant Bag",
    expected: "lemaire",
  },
  {
    text: "르메르 범백",
    expected: "lemaire",
  },
  {
    text: "AURALEE Super Fine Wool Knit",
    expected: "auralee",
  },
  {
    text: "Nike Auralee Style Jacket",
    expected: null,
  },
];

let failed = false;

for (const testCase of cases) {
  const actual =
    inferBrand(testCase.text)?.slug ?? null;

  const passed = actual === testCase.expected;

  console.log(
    passed ? "PASS" : "FAIL",
    "|",
    testCase.text,
    "| expected:",
    testCase.expected,
    "| actual:",
    actual,
  );

  if (!passed) {
    failed = true;
  }
}

console.log(
  "DKNY matches NEEDLES:",
  matchesExpectedBrand(
    "DKNY Women's Logo T-Shirt",
    "needles",
  ),
);

if (failed) {
  process.exitCode = 1;
}
