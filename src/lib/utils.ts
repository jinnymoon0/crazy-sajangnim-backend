/*
 * Pricing helpers shared by the collectors. The frontend keeps its own
 * copy of the display helpers (formatPrice, cn); only the arithmetic
 * belongs to the collection service.
 */
export function calculateDiscountPercentage(
  originalPrice: number,
  salePrice: number,
): number {
  if (
    !Number.isFinite(originalPrice) ||
    !Number.isFinite(salePrice) ||
    originalPrice <= 0 ||
    salePrice < 0 ||
    salePrice >= originalPrice
  ) {
    return 0;
  }

  return Math.round(((originalPrice - salePrice) / originalPrice) * 100);
}
