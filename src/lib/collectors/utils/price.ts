export function parseKrwPrice(
  value: string | undefined,
): number | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/[^\d]/g, "");

  if (!digits) {
    return null;
  }

  const price = Number.parseInt(digits, 10);

  return Number.isFinite(price) && price > 0
    ? price
    : null;
}

export function isRealSale(
  originalPrice: number | null,
  salePrice: number | null,
): originalPrice is number {
  return Boolean(
    originalPrice &&
      salePrice &&
      originalPrice > salePrice &&
      salePrice > 0,
  );
}
