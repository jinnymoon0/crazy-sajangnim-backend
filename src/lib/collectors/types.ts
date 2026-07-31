import type { BrandSlug } from "@/constants/brands";
import type { CategorySlug } from "@/constants/categories";
import type { Gender, Product } from "@/types/product";

export type ProductCategory = Exclude<CategorySlug, "all">;
export type SelectableGender = Exclude<Gender, "UNISEX">;

export interface RawRetailerProduct {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;

  title: string;
  brandSlug: BrandSlug;
  brandName: string;

  category: ProductCategory;
  gender: Gender;

  imageUrl: string;

  originalPrice: number;
  salePrice: number;

  isAvailable: boolean;
}

export interface KoreanRetailerCollector {
  sourceName: string;
  sourceSlug: string;
  baseUrl: string;

  collect(
    requestedGender: SelectableGender,
  ): Promise<RawRetailerProduct[]>;
}

export function toProduct(
  raw: RawRetailerProduct,
): Product {
  const discountPercentage = Math.round(
    ((raw.originalPrice - raw.salePrice) /
      raw.originalPrice) *
      100,
  );

  return {
    id: `${raw.sourceName}-${raw.sourceId}`,
    sourceName: raw.sourceName,
    sourceUrl: raw.sourceUrl,

    market: "KR",
    currency: "KRW",
    gender: raw.gender,

    brandSlug: raw.brandSlug,
    brandName: raw.brandName,

    productName: raw.title,
    categorySlug: raw.category,

    imageUrl: raw.imageUrl,

    originalPrice: raw.originalPrice,
    salePrice: raw.salePrice,
    discountPercentage,
    saleVerification: "VERIFIED",

    isAvailable: raw.isAvailable,
    collectedAt: new Date().toISOString(),
  };
}
