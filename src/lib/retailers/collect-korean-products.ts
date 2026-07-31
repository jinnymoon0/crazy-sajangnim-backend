import pLimit from "p-limit";
import type { BrandSlug } from "@/constants/brands";
import type { Product } from "@/types/product";
import { discoverKoreanRetailerPages } from "./google-retailer-search";
import { parseRetailerProductPage } from "./parse-retailer-product";

interface CollectOptions {
  brandSlug: BrandSlug;
  englishBrandName: string;
  koreanBrandName: string;

  gender: "MEN" | "WOMEN";
}

export async function collectKoreanRetailerProducts({
  brandSlug,
  englishBrandName,
  koreanBrandName,
  gender,
}: CollectOptions): Promise<Product[]> {
  const candidates = await discoverKoreanRetailerPages({
    englishBrandName,
    koreanBrandName,
    gender,

    /*
     * Search the first six configured retailers:
     * Naver, OKmall, LFmall, KOLON, Musinsa and 29CM.
     */
    maxRetailers: 6,
  });

  /*
   * Parse no more than 24 product candidates per brand.
   */
  const limitedCandidates = candidates.slice(0, 24);
  const limit = pLimit(4);

  const settled = await Promise.allSettled(
    limitedCandidates.map((candidate) =>
      limit(() =>
        parseRetailerProductPage({
          retailerName: candidate.retailerName,
          url: candidate.url,
          fallbackTitle: candidate.title,
          fallbackThumbnail: candidate.thumbnail,
          brandSlug,
          brandName: englishBrandName,
          gender,
        }),
      ),
    ),
  );

  const products = settled.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );

  return Array.from(
    new Map(
      products.map((product) => [
        `${product.sourceName}|${product.sourceUrl}`,
        product,
      ]),
    ).values(),
  );
}
