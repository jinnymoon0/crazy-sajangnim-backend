import type { BrandRecord } from "@/lib/products/brand-repository";
import { BRANDS } from "@/constants/brands";

/*
 * Brand matching runs inside HTML parsing, which is synchronous and
 * called for every card on every page. Rather than make that path
 * async, a collection run loads the tracked brands once and installs
 * them here; everything downstream reads them synchronously.
 *
 * The shipped list is the default, so anything that parses without a
 * collection run (tests, one-off scripts) still works.
 */
const SEED: BrandRecord[] = BRANDS.map((brand) => ({
  slug: brand.slug,
  englishName: brand.englishName,
  koreanName: brand.koreanName,
  aliases: [...brand.aliases],
  isActive: true,
  addedBy: "seed",
  createdAt: null,
}));

let activeBrands: BrandRecord[] = SEED;

export function setActiveBrands(brands: BrandRecord[]): void {
  activeBrands = brands.length > 0 ? brands : SEED;
}

export function getActiveBrands(): BrandRecord[] {
  return activeBrands;
}
