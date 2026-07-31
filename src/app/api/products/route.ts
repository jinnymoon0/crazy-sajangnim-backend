import { createHash } from "node:crypto";
import pLimit from "p-limit";
import { NextRequest, NextResponse } from "next/server";

import { type BrandSlug } from "@/constants/brands";
import {
  getBrands,
  type BrandRecord,
} from "@/lib/products/brand-repository";
import { setActiveBrands } from "@/lib/products/brand-registry";
import { inferBrand } from "@/lib/products/infer-brand";
import { inferCategory } from "@/lib/products/infer-category";
import { extractProductsFromPage } from "@/lib/products/extract-products-from-page";
import { upsertProducts } from "@/lib/products/product-repository";
import { collectDirectProducts } from "@/lib/products/sources";
import { searchSearxng, type SearxngResult } from "@/lib/search/searxng";
import {
  isAuthorizedService,
  unauthorizedResponse,
} from "@/lib/service-auth";
import { calculateDiscountPercentage } from "@/lib/utils";
import type { Gender, Market, Product } from "@/types/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type BrandSearch = BrandRecord;

interface BrandSearchDiagnostics {
  explicitBrandMatches: number;
  resultsWithImages: number;
  resultsWithPrices: number;
  resultsWithSaleTerms: number;
  secondHandResults: number;
  pageCandidates: number;
  extractedProducts: number;
  fallbackProducts: number;
}

interface BrandSearchResult {
  products: Product[];
  rawCount: number;
  unresponsiveEngines: Array<[string, string]>;
  diagnostics: BrandSearchDiagnostics;
  error?: string;
}

interface ParsedPrices {
  salePrice: number;
  originalPrice: number;
  discountPercentage: number;
}

const BLOCKED_DIRECT_RETAILER_DOMAINS = ["lyst.com", "farfetch.com"];

const BLOCKED_RESULT_DOMAINS = [
  "wikipedia.org",
  "vogue.com",
  "pinterest.com",
  "instagram.com",
  "facebook.com",
  "youtube.com",
  "reddit.com",
];

const BLOCKED_PRODUCT_URL_TERMS = [
  "/wiki/",
  "/fashion-shows/",
  "/collections/",
  "/collection/",
  "/brands/",
  "/brand/",
  "/search",
  "brandshop",
  "brandShop",
];

const MEN_ONLY_BRAND_SLUGS = new Set<BrandSlug>([
  "beams-plus",
  "comoli",
  "kamiya",
]);

const SECOND_HAND_TERMS = [
  "used",
  "pre-owned",
  "preowned",
  "second hand",
  "second-hand",
  "resale",
  "poshmark",
  "therealreal",
  "grailed",
  "ebay",
  "중고",
  "리셀",
  "번개장터",
  "당근",
];

const SALE_TERMS = [
  "sale",
  "clearance",
  "discount",
  "off",
  "outlet",
  "markdown",
  "세일",
  "할인",
  "시즌오프",
  "아울렛",
  "특가",
];

function isMarket(value: string | null): value is Market {
  return value === "US" || value === "KR";
}

function isRequestedGender(
  value: string | null,
): value is Exclude<Gender, "UNISEX"> {
  return value === "MEN" || value === "WOMEN";
}

function createBrandSearchExpression(
  brand: BrandSearch,
  market: Market,
): string {
  const aliases =
    market === "KR"
      ? brand.aliases
      : brand.aliases.filter((alias) => /[A-Za-z]/.test(alias));

  return `(${aliases
    .map((alias) => `"${alias.replace(/"/g, '\\"')}"`)
    .join(" OR ")})`;
}

function createQuery(
  brand: BrandSearch,
  market: Market,
  gender: Exclude<Gender, "UNISEX">,
): string {
  if (market === "KR") {
    const genderTerms =
      gender === "MEN" ? "(남성 OR 남자 OR 맨즈)" : "(여성 OR 여자 OR 우먼)";

    return [
      createBrandSearchExpression(brand, "KR"),
      genderTerms,
      "(세일 OR 할인 OR 시즌오프 OR 아울렛)",
      "(의류 OR 자켓 OR 팬츠 OR 셔츠 OR 니트 OR 신발 OR 가방)",
      "-중고",
      "-리셀",
    ].join(" ");
  }

  const genderTerms =
    gender === "MEN"
      ? '(men OR mens OR menswear OR "men\'s")'
      : '(women OR womens OR womenswear OR "women\'s" OR female)';

  return [
    createBrandSearchExpression(brand, "US"),
    genderTerms,
    "(sale OR clearance OR discount OR outlet)",
    "(clothing OR jacket OR pants OR shirt OR knitwear OR shoes OR bag)",
    "-used",
    "-resale",
    "-preowned",
  ].join(" ");
}

function getResultText(result: SearxngResult): string {
  return [result.title, result.content, result.url]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function containsSaleTerm(text: string): boolean {
  const normalized = text.toLowerCase();

  return SALE_TERMS.some((term) => normalized.includes(term));
}

function isSecondHandResult(text: string): boolean {
  const normalized = text.toLowerCase();

  return SECOND_HAND_TERMS.some((term) => normalized.includes(term));
}

function extractDiscountPercentage(text: string): number | null {
  const patterns = [
    /(\d{1,2})\s*%\s*(?:off|discount|할인)/i,
    /(?:up to|최대)\s*(\d{1,2})\s*%/i,
    /(?:할인율\s*)?(\d{1,2})\s*%/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (!match) {
      continue;
    }

    const percentage = Number.parseInt(match[1], 10);

    if (percentage > 0 && percentage < 100) {
      return percentage;
    }
  }

  return null;
}

function extractUsdPrices(text: string): number[] {
  const matches = Array.from(text.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g));

  return matches
    .map((match) => Number.parseFloat(match[1].replace(/,/g, "")))
    .filter(
      (value) => Number.isFinite(value) && value > 0 && value < 1_000_000,
    );
}

function extractKrwPrices(text: string): number[] {
  const wonSuffixMatches = Array.from(text.matchAll(/([\d,]{3,})\s*원/g)).map(
    (match) => Number.parseInt(match[1].replace(/,/g, ""), 10),
  );

  const wonPrefixMatches = Array.from(
    text.matchAll(/(?:₩|KRW)\s*([\d,]+)/gi),
  ).map((match) => Number.parseInt(match[1].replace(/,/g, ""), 10));

  return [...wonSuffixMatches, ...wonPrefixMatches].filter(
    (value) =>
      Number.isFinite(value) && value >= 1_000 && value < 1_000_000_000,
  );
}

function uniqueSortedPrices(prices: number[]): number[] {
  return Array.from(
    new Set(prices.map((price) => Math.round(price * 100) / 100)),
  ).sort((a, b) => a - b);
}

function resolveSalePrices(text: string, market: Market): ParsedPrices | null {
  const prices = uniqueSortedPrices(
    market === "KR" ? extractKrwPrices(text) : extractUsdPrices(text),
  );

  const explicitDiscount = extractDiscountPercentage(text);

  if (prices.length >= 2) {
    const salePrice = prices[0];
    const originalPrice = prices[prices.length - 1];

    if (originalPrice > salePrice) {
      return {
        salePrice,
        originalPrice,
        discountPercentage: calculateDiscountPercentage(
          originalPrice,
          salePrice,
        ),
      };
    }
  }

  if (prices.length >= 1 && explicitDiscount) {
    const salePrice = prices[0];
    const originalPrice = salePrice / (1 - explicitDiscount / 100);

    if (Number.isFinite(originalPrice) && originalPrice > salePrice) {
      return {
        salePrice,
        originalPrice:
          market === "KR"
            ? Math.round(originalPrice / 10) * 10
            : Math.round(originalPrice * 100) / 100,
        discountPercentage: explicitDiscount,
      };
    }
  }

  return null;
}

function resolveSingleSalePrice(text: string, market: Market): number | null {
  const prices = uniqueSortedPrices(
    market === "KR" ? extractKrwPrices(text) : extractUsdPrices(text),
  );

  if (prices.length === 0) {
    return null;
  }

  /*
   * The result has already passed the sale-term check.
   * Use the lowest visible price as an unverified sale price
   * when no original price is available.
   */
  return prices[0];
}

function getSourceName(result: SearxngResult): string {
  try {
    return new URL(result.url).hostname.replace(/^www\./, "");
  } catch {
    return result.engine?.trim() || "Online retailer";
  }
}

const NON_PRODUCT_IMAGE_TERMS = [
  "logo",
  "favicon",
  "wordmark",
  "brandmark",
  "sprite",
  "avatar",
  "banner",
  "header",
  "placeholder",
  "default-image",
  "no-image",
];

function getImageUrl(result: SearxngResult): string | null {
  const image = result.thumbnail?.trim() || result.img_src?.trim();

  if (!image || !/^https?:\/\//i.test(image)) {
    return null;
  }

  const normalizedImage = image.toLowerCase();

  if (NON_PRODUCT_IMAGE_TERMS.some((term) => normalizedImage.includes(term))) {
    return null;
  }

  return image;
}

function createProductId(result: SearxngResult): string {
  return createHash("sha256")
    .update([result.title, result.url, result.engine ?? ""].join("|"))
    .digest("hex")
    .slice(0, 24);
}

function normalizeBrandText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resultExplicitlyMatchesBrand(
  result: SearxngResult,
  brand: BrandSearch,
): boolean {
  const title = normalizeBrandText(result.title ?? "");

  const url = normalizeBrandText(result.url ?? "");

  const normalizedAliases = brand.aliases.map(normalizeBrandText);

  const slugName = normalizeBrandText(brand.slug.replace(/-/g, " "));

  /*
   * Require a canonical name or alias in the title or URL. A snippet that
   * merely mentions the brand among unrelated brands is not sufficient.
   */
  return (
    normalizedAliases.some(
      (alias) =>
        title.includes(alias) ||
        url.includes(alias) ||
        url.includes(alias.replace(/ /g, "")),
    ) ||
    title.includes(slugName) ||
    url.includes(slugName.replace(/ /g, ""))
  );
}

function isBlockedResultUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    if (
      BLOCKED_DIRECT_RETAILER_DOMAINS.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      )
    ) {
      return true;
    }
    const pathAndQuery = `${url.pathname}${url.search}`.toLowerCase();

    if (
      BLOCKED_RESULT_DOMAINS.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      )
    ) {
      return true;
    }

    return BLOCKED_PRODUCT_URL_TERMS.some((term) =>
      pathAndQuery.includes(term.toLowerCase()),
    );
  } catch {
    return true;
  }
}

function isReasonablePrice(price: number, market: Market): boolean {
  if (!Number.isFinite(price)) {
    return false;
  }

  return market === "KR"
    ? price >= 10_000 && price <= 20_000_000
    : price >= 20 && price <= 50_000;
}

function normalizeProduct(
  result: SearxngResult,
  brand: BrandSearch,
  market: Market,
  requestedGender: Exclude<Gender, "UNISEX">,
): Product | null {
  const title = result.title.trim();
  const sourceUrl = result.url.trim();

  if (isBlockedResultUrl(sourceUrl)) {
    return null;
  }

  if (!resultExplicitlyMatchesBrand(result, brand)) {
    return null;
  }
  const imageUrl = getImageUrl(result) ?? "/product-placeholder.svg";

  const text = getResultText(result);

  if (!title || !sourceUrl) {
    return null;
  }

  /*
   * Every result was discovered through a sale-specific query.
   * Search-engine snippets do not always repeat the words
   * "sale", "discount", or "clearance", so do not reject a
   * result solely because the snippet omits those terms.
   */
  if (isSecondHandResult(text)) {
    return null;
  }

  const detectedBrand = inferBrand(text);

  if (!detectedBrand || detectedBrand.slug !== brand.slug) {
    return null;
  }

  const verifiedPrices = resolveSalePrices(text, market);

  const fallbackSalePrice = verifiedPrices
    ? null
    : resolveSingleSalePrice(text, market);

  if (!verifiedPrices && !fallbackSalePrice) {
    return null;
  }

  const salePrice = verifiedPrices?.salePrice ?? fallbackSalePrice;

  if (!salePrice || !isReasonablePrice(salePrice, market)) {
    return null;
  }

  return {
    id: createProductId(result),

    sourceName: getSourceName(result),
    sourceUrl,

    market,
    currency: market === "KR" ? "KRW" : "USD",

    gender: requestedGender,

    brandSlug: detectedBrand.slug,
    brandName: detectedBrand.name,

    productName: title,
    categorySlug: inferCategory(text),

    imageUrl,

    originalPrice: verifiedPrices?.originalPrice ?? null,

    salePrice,

    discountPercentage: verifiedPrices?.discountPercentage ?? null,

    /*
     * Snippet-derived pairs take the lowest and highest prices mentioned in
     * a search result, which routinely mixes unrelated products. Treat every
     * snippet price as an estimate; only page-level structured data or a
     * direct retailer feed may produce VERIFIED prices.
     */
    saleVerification: "UNVERIFIED",

    isAvailable: true,
    collectedAt: new Date().toISOString(),
  };
}

function createRetailerQueries(
  brand: BrandSearch,
  gender: Exclude<Gender, "UNISEX">,
): string[] {
  const genderTerm =
    gender === "MEN"
      ? '(men OR mens OR menswear OR "men\'s")'
      : '(women OR womens OR womenswear OR "women\'s" OR female)';

  const preferredDomains = [
    "ssense.com",
    "farfetch.com",
    "yoox.com",
    "modesens.com",
    "endclothing.com",
    "shopneighbour.com",
    "tres-bien.com",
    "svrn.com",
    "mytheresa.com",
    "net-a-porter.com",
    "24s.com",
    "luisaviaroma.com",
    "ln-cc.com",
    "slamjam.com",
    "havenshop.com",
    "canoeclub.us",
    "shoplostfound.com",
    "norsestore.com",
    "goodhoodstore.com",
  ];

  return preferredDomains.map((domain) =>
    [
      `site:${domain}`,
      createBrandSearchExpression(brand, "US"),
      genderTerm,
      "(sale OR clearance OR discount)",
      '("$" OR "sale price" OR "regular price")',
      "-used",
      "-resale",
      "-preowned",
    ].join(" "),
  );
}

function createDirectRetailerQueries(
  brand: BrandSearch,
  gender: Exclude<Gender, "UNISEX">,
): string[] {
  const genderTerms =
    gender === "MEN"
      ? '(men OR mens OR menswear OR "men\'s")'
      : '(women OR womens OR womenswear OR "women\'s" OR female)';

  const domains = [
    "lyst.com",
    "lyst.co.uk",
    "farfetch.com",
    "ssense.com",
    "endclothing.com",
    "yoox.com",
    "modesens.com",
    "hbx.com",
    "mrporter.com",
    "shopneighbour.com",
    "svrn.com",
    "tres-bien.com",
    "italist.com",
    "cettire.com",
    "giglio.com",
    "vitkac.com",
    "24s.com",
    "mytheresa.com",
    "net-a-porter.com",
    "nordstrom.com",
    "saksfifthavenue.com",
    "bergdorfgoodman.com",
    "harrods.com",
    "libertylondon.com",
    "ln-cc.com",
    "matchesfashion.com",
    "luisaviaroma.com",
    "brownsfashion.com",
    "thewebster.com",
    "wrongweather.net",
    "slamjam.com",
    "bstn.com",
    "feature.com",
    "bodega.com",
    "unionlosangeles.com",
    "canoeclub.us",
    "bluebuttonshop.com",
    "shoplostfound.com",
    "havenshop.com",
    "gravitypope.com",
    "goodhoodstore.com",
    "couvertureandthegarbstore.com",
    "norsestore.com",
    "ssense.com",
    "shopbop.com",
    "revolve.com",
  ];

  return domains.map((domain) =>
    [
      `site:${domain}`,
      createBrandSearchExpression(brand, "US"),
      genderTerms,
      "(sale OR discount OR clearance OR markdown)",
      "-used",
      "-resale",
      "-preowned",
    ].join(" "),
  );
}

function createCategoryQueries(
  brand: BrandSearch,
  market: Market,
  gender: Exclude<Gender, "UNISEX">,
): string[] {
  if (market === "KR") {
    const genderTerms =
      gender === "MEN" ? "(남성 OR 남자 OR 맨즈)" : "(여성 OR 여자 OR 우먼)";

    const categories = [
      "자켓 코트 블레이저",
      "셔츠 블라우스 티셔츠",
      "니트 스웨터 가디건 베스트",
      "팬츠 바지 데님 청바지",
      "스커트 원피스 드레스",
      "신발 스니커즈 부츠 샌들",
      "가방 토트백 숄더백",
      "모자 벨트 지갑 액세서리",
    ];

    return categories.map((category) =>
      [
        createBrandSearchExpression(brand, "KR"),
        genderTerms,
        `(${category})`,
        "(세일 OR 할인 OR 시즌오프 OR 아울렛)",
        "-중고",
        "-리셀",
      ].join(" "),
    );
  }

  const genderTerms =
    gender === "MEN"
      ? '(men OR mens OR menswear OR "men\'s")'
      : '(women OR womens OR womenswear OR "women\'s" OR female)';

  const categories = [
    "(jacket OR coat OR blazer OR outerwear)",
    "(shirt OR blouse OR t-shirt OR polo OR top)",
    "(sweater OR knitwear OR cardigan OR vest)",
    "(pants OR trousers OR jeans OR shorts)",
    "(skirt OR dress OR gown)",
    "(shoes OR sneakers OR boots OR sandals OR loafers)",
    "(bag OR tote OR shoulder bag OR backpack)",
    "(hat OR belt OR wallet OR scarf OR accessories)",
  ];

  return categories.map((category) =>
    [
      createBrandSearchExpression(brand, "US"),
      genderTerms,
      category,
      "(sale OR clearance OR discount OR markdown)",
      '("$" OR "sale price" OR "regular price")',
      "-used",
      "-resale",
      "-preowned",
    ].join(" "),
  );
}

function createKoreanRetailerQueries(
  brand: BrandSearch,
  gender: Exclude<Gender, "UNISEX">,
): string[] {
  const genderTerms =
    gender === "MEN" ? "(남성 OR 남자 OR 맨즈)" : "(여성 OR 여자 OR 우먼)";

  const domains = [
    "musinsa.com",
    "29cm.co.kr",
    "wconcept.co.kr",
    "ssfshop.com",
    "lfmall.co.kr",
    "hanstyle.com",
    "trenbe.com",
    "mustit.co.kr",
    "balaan.co.kr",
    "lotteon.com",
    "ssg.com",
    "galleria.co.kr",
    "thehyundai.com",
    "shinsegaemall.ssg.com",
    "kream.co.kr",
    "empty.seoul.kr",
    "8division.com",
    "beakerstore.com",
    "worksout.co.kr",
    "kasina.co.kr",
    "boon-shop.com",
    "eqlstore.com",
    "hago.kr",
    "ocokorea.com",
  ];

  return domains.map((domain) =>
    [
      `site:${domain}`,
      createBrandSearchExpression(brand, "KR"),
      genderTerms,
      "(세일 OR 할인 OR 시즌오프 OR 아울렛 OR 특가)",
      '("판매가" OR "할인가" OR "정가" OR "원")',
      "-중고",
      "-리셀",
    ].join(" "),
  );
}

function createWomenProductQueries(brand: BrandSearch): string[] {
  const categories = [
    "dress",
    "skirt",
    "blouse",
    "women jacket",
    "women trousers",
    "women sweater",
    "women shirt",
    "women shoes",
    "women bag",
    "women accessories",
  ];

  const domains = [
    "lyst.com",
    "farfetch.com",
    "ssense.com",
    "yoox.com",
    "modesens.com",
    "mytheresa.com",
    "net-a-porter.com",
    "24s.com",
    "shopbop.com",
    "revolve.com",
    "luisaviaroma.com",
    "cettire.com",
  ];

  return domains.flatMap((domain) =>
    categories.map((category) =>
      [
        `site:${domain}`,
        createBrandSearchExpression(brand, "US"),
        `"${category}"`,
        "(sale OR discount OR clearance OR markdown)",
        "-used",
        "-resale",
        "-preowned",
      ].join(" "),
    ),
  );
}

function createSearchQueries(
  brand: BrandSearch,
  market: Market,
  gender: Exclude<Gender, "UNISEX">,
): string[] {
  const baseQuery = createQuery(brand, market, gender);

  if (market === "KR") {
    return [
      baseQuery,
      ...createCategoryQueries(brand, market, gender),
      ...createKoreanRetailerQueries(brand, gender),
      [
        createBrandSearchExpression(brand, "KR"),
        gender === "MEN" ? "(남성 OR 남자 OR 맨즈)" : "(여성 OR 여자 OR 우먼)",
        "(세일 OR 할인 OR 시즌오프 OR 아울렛)",
        '("판매가" OR "할인가" OR "정가" OR "원")',
        "-중고",
        "-리셀",
      ].join(" "),
      [
        createBrandSearchExpression(brand, "KR"),
        gender === "MEN" ? "(남성 OR 남자 OR 맨즈)" : "(여성 OR 여자 OR 우먼)",
        '("판매가" OR "할인가")',
        "(자켓 OR 셔츠 OR 팬츠 OR 니트 OR 신발 OR 가방)",
        "-컬렉션",
        "-중고",
        "-리셀",
      ].join(" "),
    ];
  }

  return [
    baseQuery,
    ...createCategoryQueries(brand, market, gender),
    ...(gender === "WOMEN" ? createWomenProductQueries(brand) : []),
    ...createDirectRetailerQueries(brand, gender),
    ...createRetailerQueries(brand, gender),
    [
      createBrandSearchExpression(brand, "US"),
      gender === "MEN" ? "(men OR mens)" : "(women OR womens)",
      "(sale OR clearance OR discount OR outlet)",
      '("sale price" OR "regular price" OR "original price" OR "$")',
      "-used",
      "-resale",
      "-preowned",
    ].join(" "),
    [
      createBrandSearchExpression(brand, "US"),
      gender === "MEN" ? "(men OR mens)" : "(women OR womens)",
      '("sale price" OR "regular price")',
      "(jacket OR shirt OR pants OR sweater OR shoes OR bag)",
      "-collection",
      "-used",
      "-resale",
      "-preowned",
    ].join(" "),
  ];
}

async function searchAdditionalBrandPage(
  brand: BrandSearch,
  market: Market,
  gender: Exclude<Gender, "UNISEX">,
): Promise<SearxngResult[]> {
  try {
    const response = await searchSearxng(createQuery(brand, market, gender), {
      language: market === "KR" ? "ko-KR" : "en-US",
      page: 4,
    });

    return response.results;
  } catch {
    return [];
  }
}

async function searchBrand(
  brand: BrandSearch,
  market: Market,
  gender: Exclude<Gender, "UNISEX">,
): Promise<BrandSearchResult> {
  const collectedResults: SearxngResult[] = [];
  const unresponsiveEngines: Array<[string, string]> = [];
  const errors: string[] = [];

  const queries = createSearchQueries(brand, market, gender);

  for (const [queryIndex, query] of queries.entries()) {
    const pages = queryIndex < 7 ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2];

    for (const page of pages) {
      try {
        const response = await searchSearxng(query, {
          language: market === "KR" ? "ko-KR" : "en-US",
          page,
        });

        collectedResults.push(...response.results);

        unresponsiveEngines.push(...response.unresponsiveEngines);
      } catch (error) {
        errors.push(
          error instanceof Error ? error.message : "Unknown SearXNG error",
        );
      }
    }
  }

  let uniqueResults = Array.from(
    new Map(collectedResults.map((result) => [result.url, result])).values(),
  );

  const fallbackProducts = uniqueResults
    .map((result) => normalizeProduct(result, brand, market, gender))
    .filter((product): product is Product => product !== null);

  if (uniqueResults.length < 35) {
    const additionalResults = await searchAdditionalBrandPage(
      brand,
      market,
      gender,
    );

    uniqueResults = Array.from(
      new Map(
        [...uniqueResults, ...additionalResults].map((result) => [
          result.url,
          result,
        ]),
      ).values(),
    );
  }

  const pageCandidates = uniqueResults.filter((result) => {
    const text = getResultText(result);

    return (
      resultExplicitlyMatchesBrand(result, brand) && !isSecondHandResult(text)
    );
  });

  const pageLimit = pLimit(8);

  const settledPages = await Promise.allSettled(
    pageCandidates.map((result) =>
      pageLimit(() =>
        extractProductsFromPage({
          pageUrl: result.url,
          market,
          requestedGender: gender,
          brandSlug: brand.slug,
          brandName: brand.englishName,
          maxProducts: 150,
        }),
      ),
    ),
  );

  const extractedProducts = settledPages.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );

  const products = Array.from(
    new Map(
      [...extractedProducts, ...fallbackProducts].map((product) => [
        [product.sourceUrl, product.productName, product.salePrice].join("|"),
        product,
      ]),
    ).values(),
  );

  const uniqueEngineErrors = Array.from(
    new Map(
      unresponsiveEngines.map((engineError) => [
        engineError.join("|"),
        engineError,
      ]),
    ).values(),
  );

  /*
   * Return every validated and deduplicated product.
   * Accuracy checks still occur before this point.
   */

  const diagnostics: BrandSearchDiagnostics = {
    explicitBrandMatches: uniqueResults.filter((result) =>
      resultExplicitlyMatchesBrand(result, brand),
    ).length,

    resultsWithImages: uniqueResults.filter(
      (result) => getImageUrl(result) !== null,
    ).length,

    resultsWithPrices: uniqueResults.filter((result) => {
      const text = getResultText(result);

      return (
        resolveSalePrices(text, market) !== null ||
        resolveSingleSalePrice(text, market) !== null
      );
    }).length,

    resultsWithSaleTerms: uniqueResults.filter((result) =>
      containsSaleTerm(getResultText(result)),
    ).length,

    secondHandResults: uniqueResults.filter((result) =>
      isSecondHandResult(getResultText(result)),
    ).length,

    pageCandidates: pageCandidates.length,
    extractedProducts: extractedProducts.length,
    fallbackProducts: fallbackProducts.length,
  };

  return {
    products,
    rawCount: uniqueResults.length,
    unresponsiveEngines: uniqueEngineErrors,
    diagnostics,
    error:
      uniqueResults.length === 0 && errors.length > 0 ? errors[0] : undefined,
  };
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedService(request)) {
    return unauthorizedResponse();
  }

  const marketParameter = request.nextUrl.searchParams.get("market");

  const genderParameter = request.nextUrl.searchParams.get("gender");

  const debug = request.nextUrl.searchParams.get("debug") === "true";

  const directOnly = request.nextUrl.searchParams.get("mode") === "direct";

  const market: Market = isMarket(marketParameter) ? marketParameter : "US";

  const gender: Exclude<Gender, "UNISEX"> = isRequestedGender(genderParameter)
    ? genderParameter
    : "MEN";

  if (!directOnly && !process.env.SEARXNG_URL?.trim()) {
    return NextResponse.json(
      {
        error: "SEARXNG_URL is missing.",
      },
      {
        status: 500,
      },
    );
  }

  /*
   * Crawl retailer catalogs directly first. Persist immediately so the
   * verified products survive even if the slower search-engine phase
   * times out on the serverless runtime.
   */
  /*
   * Load the tracked brands once per request and install them for the
   * synchronous matchers, so brands added from the admin are collected
   * without a deploy.
   */
  const trackedBrands = await getBrands();

  setActiveBrands(trackedBrands);

  let directProducts: Product[] = [];
  let directSavedCount = 0;
  let directPersistenceError: string | null = null;

  try {
    directProducts = await collectDirectProducts(market);
  } catch (error) {
    console.error("Direct source collection failed:", error);
  }

  if (directProducts.length > 0) {
    try {
      directSavedCount = await upsertProducts(directProducts);
    } catch (error) {
      directPersistenceError =
        error instanceof Error
          ? error.message
          : "Unable to save direct source products.";

      console.error("Direct product persistence failed:", error);
    }
  }

  const visibleDirectProducts = directProducts.filter(
    (product) => product.gender === gender || product.gender === "UNISEX",
  );

  if (directOnly) {
    return NextResponse.json({
      products: visibleDirectProducts,
      count: visibleDirectProducts.length,
      market,
      gender,
      updatedAt: new Date().toISOString(),

      ...(debug
        ? {
            diagnostics: {
              provider: "direct",
              directCollected: directProducts.length,
              directSavedCount,
              directPersistenceError,
            },
          }
        : {}),
    });
  }

  const brandLimit = pLimit(2);

  const searchableBrands = trackedBrands.filter(
    (brand) => gender !== "WOMEN" || !MEN_ONLY_BRAND_SLUGS.has(brand.slug),
  );

  const results = await Promise.all(
    searchableBrands.map((brand) =>
      brandLimit(() => searchBrand(brand, market, gender)),
    ),
  );

  const allProducts = results.flatMap((result) => result.products);

  const products = Array.from(
    new Map(
      allProducts.map((product) => [
        [product.sourceName, product.productName, product.salePrice].join("|"),
        product,
      ]),
    ).values(),
  );

  const errors = results
    .map((result) => result.error)
    .filter((error): error is string => Boolean(error));

  if (
    products.length === 0 &&
    visibleDirectProducts.length === 0 &&
    errors.length === results.length
  ) {
    return NextResponse.json(
      {
        error: errors[0] ?? "Unable to retrieve sale listings.",
      },
      {
        status: 502,
      },
    );
  }

  let savedCount = 0;
  let persistenceError: string | null = null;

  try {
    savedCount = await upsertProducts(products);
  } catch (error) {
    persistenceError =
      error instanceof Error
        ? error.message
        : "Unable to save products to the catalog.";

    console.error("Product catalog persistence failed:", error);
  }

  const combinedProducts = Array.from(
    new Map(
      [...visibleDirectProducts, ...products].map((product) => [
        [product.sourceName, product.productName, product.salePrice].join("|"),
        product,
      ]),
    ).values(),
  );

  return NextResponse.json({
    products: combinedProducts,
    count: combinedProducts.length,
    market,
    gender,
    updatedAt: new Date().toISOString(),

    ...(debug
      ? {
          diagnostics: {
            provider: "searxng+direct",

            directCollected: directProducts.length,
            directSavedCount,
            directPersistenceError,

            brandSearches: searchableBrands.length,

            rawResults: results.reduce(
              (total, result) => total + result.rawCount,
              0,
            ),

            productsBeforeDeduplication: allProducts.length,

            productsAfterDeduplication: products.length,

            savedCount,
            persistenceError,

            byBrand: searchableBrands.map((brand, index) => ({
              brand: brand.englishName,
              rawResults: results[index].rawCount,
              products: results[index].products.length,
              rejectionDiagnostics: results[index].diagnostics,
              error: results[index].error,
              unresponsiveEngines: results[index].unresponsiveEngines,
            })),
          },
        }
      : {}),
  });
}
