export function absoluteUrl(
  value: string | undefined,
  baseUrl: string,
): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}
