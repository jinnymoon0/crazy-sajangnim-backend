import type { Gender, Market, Product } from "@/types/product";

export const DIRECT_SOURCE_USER_AGENT =
  process.env.COLLECTOR_USER_AGENT ??
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const WOMEN_KEYWORDS = [
  "women",
  "women's",
  "womens",
  "womenswear",
  "woman",
  "ladies",
  "female",
  "여성",
  "여자",
  "우먼",
];

/*
 * "menswear" is listed explicitly: the plain keywords match whole words
 * only, so a retailer category like "menswear-jackets" would otherwise
 * fall through and be treated as unisex — putting men's jackets in
 * front of shoppers browsing womenswear.
 */
const MEN_KEYWORDS = [
  " men ",
  " mens ",
  "men's",
  "menswear",
  " man ",
  "male",
  "남성",
  "남자",
  "맨즈",
];

/*
 * Garment types that identify womenswear when the listing carries no
 * explicit gender wording. "dress" must not match dress shirts, dress
 * pants, or dress shoes.
 */
const WOMEN_GARMENT_PATTERNS = [
  /\bdress(es)?\b(?!\s+(shirt|shirts|pant|pants|shoe|shoes|sock|socks))/,
  /\bskirts?\b/,
  /\bblouses?\b/,
  /\bgowns?\b/,
  /\bheeled\b/,
  /\bheels\b/,
  /\blingerie\b/,
  /\bpanties\b/,
  /\bbodysuits?\b/,
  /\bbralettes?\b/,
  /\bcamisoles?\b/,
  /\bcorsets?\b/,
  /\bstrapless\b/,
  /원피스/,
  /스커트/,
  /블라우스/,
];

/*
 * Unlike inferGender, a direct catalog crawl has no requested gender to fall
 * back on: the source default may legitimately be UNISEX, which the catalog
 * read path surfaces in both gender segments.
 */
export function resolveGender(text: string, fallback: Gender): Gender {
  const normalized = ` ${text.toLowerCase().replace(/[/_-]+/g, " ")} `;

  if (WOMEN_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "WOMEN";
  }

  if (MEN_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "MEN";
  }

  if (WOMEN_GARMENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "WOMEN";
  }

  return fallback;
}

export function isReasonablePrice(price: number, market: Market): boolean {
  if (!Number.isFinite(price)) {
    return false;
  }

  return market === "KR"
    ? price >= 10_000 && price <= 20_000_000
    : price >= 20 && price <= 50_000;
}

export function parseUsdAmount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/([\d,]+(?:\.\d{1,2})?)/);

  if (!match) {
    return null;
  }

  const parsed = Number.parseFloat(match[1].replace(/,/g, ""));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function dedupeProducts(products: Product[]): Product[] {
  return Array.from(
    new Map(
      products.map((product) => [
        [product.sourceUrl, product.productName, product.salePrice].join("|"),
        product,
      ]),
    ).values(),
  );
}

export async function fetchWithTimeout(
  url: string,
  init?: {
    accept?: string;
    timeoutMs?: number;
  },
): Promise<Response> {
  return fetch(url, {
    headers: {
      Accept: init?.accept ?? "application/json",
      "User-Agent": DIRECT_SOURCE_USER_AGENT,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(init?.timeoutMs ?? 15_000),
  });
}
