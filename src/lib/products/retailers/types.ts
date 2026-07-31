import type { BrandSlug } from "@/constants/brands";
import type { Gender, Market, Product } from "@/types/product";

export interface RetailerAdapterOptions {
  $: import("cheerio").CheerioAPI;
  html: string;
  pageUrl: string;

  market: Market;
  requestedGender: Exclude<Gender, "UNISEX">;

  brandSlug: BrandSlug;
  brandName: string;

  maxProducts: number;
}

export type RetailerAdapter = (options: RetailerAdapterOptions) => Product[];
