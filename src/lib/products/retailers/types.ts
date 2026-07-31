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

  /**
   * Set for shops that sell a single label, where the store itself is
   * proof of the brand. Multi-brand boutiques must match the listing.
   */
  trustStoreBrand?: boolean;
}

export type RetailerAdapter = (options: RetailerAdapterOptions) => Product[];
