import { searchSearxng, type SearxngResult } from "@/lib/search/searxng";

import { KOREAN_RETAILERS } from "./korean-retailers";

export interface RetailerDiscoveryResult {
  retailerName: string;
  title: string;
  url: string;
  snippet: string;
  thumbnail?: string;
}

interface DiscoverOptions {
  englishBrandName: string;
  koreanBrandName: string;
  gender: "MEN" | "WOMEN";
  maxRetailers?: number;
}

function buildRetailerQuery(
  domain: string,
  englishBrandName: string,
  koreanBrandName: string,
  gender: "MEN" | "WOMEN",
): string {
  const genderTerms =
    gender === "MEN" ? "(남성 OR 남자 OR 맨즈)" : "(여성 OR 여자 OR 우먼)";

  return [
    `site:${domain}`,
    `("${englishBrandName}" OR "${koreanBrandName}")`,
    genderTerms,
    "(세일 OR 할인 OR 시즌오프 OR 아울렛)",
    "-중고",
    "-리셀",
  ].join(" ");
}

function looksLikeProductPage(result: SearxngResult): boolean {
  if (!result.url || !result.title) {
    return false;
  }

  const text = [result.title, result.content, result.url]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  const excludedTerms = [
    "고객센터",
    "이용약관",
    "개인정보",
    "브랜드관",
    "검색결과",
    "기획전 전체",
    "로그인",
    "회원가입",
  ];

  return !excludedTerms.some((term) => text.includes(term));
}

export async function discoverKoreanRetailerPages({
  englishBrandName,
  koreanBrandName,
  gender,
  maxRetailers = 6,
}: DiscoverOptions): Promise<RetailerDiscoveryResult[]> {
  const retailers = KOREAN_RETAILERS.slice(0, maxRetailers);

  const settled = await Promise.allSettled(
    retailers.flatMap((retailer) =>
      retailer.domains.slice(0, 1).map(async (domain) => {
        const query = buildRetailerQuery(
          domain,
          englishBrandName,
          koreanBrandName,
          gender,
        );

        const response = await searchSearxng(query, {
          language: "ko-KR",
          page: 1,
        });

        return response.results.filter(looksLikeProductPage).map((result) => ({
          retailerName: retailer.name,
          title: result.title,
          url: result.url,
          snippet: result.content ?? "",
          thumbnail: result.thumbnail ?? result.img_src,
        }));
      }),
    ),
  );

  const results = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );

  return Array.from(
    new Map(results.map((result) => [result.url, result])).values(),
  );
}
