import { BRANDS, type BrandSlug } from "@/constants/brands";

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

export function inferBrand(value: string): InferredBrand | null {
  const normalizedText = normalizeText(value);

  if (!normalizedText) {
    return null;
  }

  const matches = BRANDS.filter((brand) =>
    brand.aliases.some((alias) => containsAlias(normalizedText, alias)),
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
