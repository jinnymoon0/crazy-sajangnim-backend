import { type BrandSlug } from "@/constants/brands";
import { getActiveBrands } from "@/lib/products/brand-registry";

export interface InferredBrand {
  slug: BrandSlug;
  name: string;
}

const KNOWN_UNTRACKED_BRANDS = [
  "DKNY",
  "DONNA KARAN",
  "NEW BALANCE",
  "POLO RALPH LAUREN",
  "RALPH LAUREN",
  "TOMMY HILFIGER",
  "CALVIN KLEIN",
  "THE NORTH FACE",
  "MONCLER",
  "STONE ISLAND",
  "AMI PARIS",
  "MAISON KITSUNE",
  "MAISON MARGIELA",
  "ACNE STUDIOS",
  "BURBERRY",
  "GUCCI",
  "PRADA",
  "BALENCIAGA",
  "SAINT LAURENT",
  "BOTTEGA VENETA",
];

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/&amp;/gi, "&")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsLatinAlias(
  normalizedText: string,
  normalizedAlias: string,
): boolean {
  const flexibleAlias = escapeRegExp(normalizedAlias)
    .replace(/\\ /g, "[\\s_-]+")
    .replace(/-/g, "[\\s_-]*");

  return new RegExp(`(^|[^A-Z0-9])${flexibleAlias}([^A-Z0-9]|$)`, "i").test(
    normalizedText,
  );
}

function containsAlias(normalizedText: string, alias: string): boolean {
  const normalizedAlias = normalizeText(alias);

  if (!normalizedAlias) {
    return false;
  }

  return /[A-Z]/.test(normalizedAlias)
    ? containsLatinAlias(normalizedText, normalizedAlias)
    : normalizedText.includes(normalizedAlias);
}

/*
 * Brand names that are also ordinary words. ON is a real brand and also
 * the second half of "Slip-On", which filed Easymoc and Vans shoes
 * under it. These count only when the retailer itself says a product is
 * that brand — never because the word turns up in what the thing is
 * called.
 *
 * Judged by being a common word rather than by being short: 니들스, CDG
 * and ALD are just as short and are never anything but the brand.
 */
const AMBIGUOUS_ALIAS = new Set([
  "ON",
  "OFF",
  "IN",
  "OUT",
  "UP",
  "THE",
  "AND",
  "NEW",
  "ONE",
  "TWO",
  "ALL",
  "FOR",
  "PRO",
  "AIR",
  "BOX",
  "CUT",
  "FIT",
  "MIX",
  "RAW",
  "SET",
  "TOP",
  "SLIP",
  "PULL",
  "OVER",
  "WORK",
  "PLAY",
  "BASIC",
  "CLASSIC",
]);

function isAmbiguous(alias: string): boolean {
  return AMBIGUOUS_ALIAS.has(normalizeText(alias));
}

export interface InferBrandOptions {
  /*
   * The text is the retailer's own brand attribution — a vendor field, a
   * brand column — rather than a product title. Only then is a name like
   * ON trusted, because the shop is asserting it rather than the word
   * happening to appear.
   */
  fromBrandField?: boolean;
}

export function inferBrand(
  value: string,
  options: InferBrandOptions = {},
): InferredBrand | null {
  const normalizedText = normalizeText(value);

  if (!normalizedText) {
    return null;
  }

  const matches = getActiveBrands().filter((brand) =>
    brand.aliases.some(
      (alias) =>
        (options.fromBrandField || !isAmbiguous(alias)) &&
        containsAlias(normalizedText, alias),
    ),
  );

  if (matches.length !== 1) {
    return null;
  }

  const matchedBrand = matches[0];

  /*
   * NEEDLES is also an ordinary English word. Prevent unrelated products
   * such as "DKNY sewing needles" from being classified as NEEDLES.
   */
  if (
    matchedBrand.slug === "needles" &&
    KNOWN_UNTRACKED_BRANDS.some((brand) => containsAlias(normalizedText, brand))
  ) {
    return null;
  }

  return {
    slug: matchedBrand.slug,
    name: matchedBrand.englishName,
  };
}

export function matchesExpectedBrand(
  value: string,
  expectedBrandSlug: BrandSlug,
): boolean {
  return inferBrand(value)?.slug === expectedBrandSlug;
}
