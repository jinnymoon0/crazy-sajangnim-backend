export interface KoreanRetailer {
  name: string;
  aliases: string[];
  domains: string[];
}

export const KOREAN_RETAILERS: KoreanRetailer[] = [
  {
    name: "Naver Shopping",
    aliases: ["네이버쇼핑", "네이버 쇼핑", "naver shopping"],
    domains: [
      "shopping.naver.com",
      "smartstore.naver.com",
      "brand.naver.com",
    ],
  },
  {
    name: "OKmall",
    aliases: ["오케이몰", "okmall", "ok mall"],
    domains: ["okmall.com"],
  },
  {
    name: "LFmall",
    aliases: ["lf몰", "lfmall", "lf mall"],
    domains: ["lfmall.co.kr"],
  },
  {
    name: "KOLON Mall",
    aliases: ["코오롱몰", "kolon mall", "kolonmall"],
    domains: ["kolonmall.com"],
  },
  {
    name: "Musinsa",
    aliases: ["무신사", "musinsa"],
    domains: ["musinsa.com"],
  },
  {
    name: "29CM",
    aliases: ["29cm"],
    domains: ["29cm.co.kr"],
  },
  {
    name: "EQL",
    aliases: ["eql"],
    domains: ["eqlstore.com"],
  },
  {
    name: "SSF Shop",
    aliases: ["ssf샵", "ssf shop"],
    domains: ["ssfshop.com"],
  },
  {
    name: "S.I.Village",
    aliases: ["에스아이빌리지", "s.i.village", "sivillage"],
    domains: ["sivillage.com"],
  },
  {
    name: "W Concept",
    aliases: ["w컨셉", "w concept", "wconcept"],
    domains: ["wconcept.co.kr"],
  },
  {
    name: "Lotte ON",
    aliases: ["롯데온", "lotteon"],
    domains: ["lotteon.com"],
  },
  {
    name: "The Hyundai",
    aliases: ["더현대", "현대백화점", "thehyundai"],
    domains: ["thehyundai.com"],
  },
];

export function identifyKoreanRetailer(
  sourceName: string,
  sourceUrl: string,
): KoreanRetailer | null {
  const searchableText = `${sourceName} ${sourceUrl}`.toLowerCase();

  return (
    KOREAN_RETAILERS.find((retailer) =>
      [...retailer.aliases, ...retailer.domains].some((value) =>
        searchableText.includes(value.toLowerCase()),
      ),
    ) ?? null
  );
}

export function getKoreanRetailerPriority(
  sourceName: string,
  sourceUrl: string,
): number {
  const retailer = identifyKoreanRetailer(sourceName, sourceUrl);

  if (!retailer) {
    return 0;
  }

  const index = KOREAN_RETAILERS.indexOf(retailer);
  return KOREAN_RETAILERS.length - index;
}
