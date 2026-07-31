import type { Product } from "@/types/product";

import { parseCafe24Products } from "./cafe24";
import { parseLystProducts } from "./lyst";
import type { RetailerAdapterOptions } from "./types";

function getHostname(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function parseRetailerProducts(
  options: RetailerAdapterOptions,
): Product[] {
  const hostname = getHostname(options.pageUrl);

  if (
    hostname === "lyst.com" ||
    hostname.endsWith(".lyst.com") ||
    hostname === "lyst.co.uk" ||
    hostname.endsWith(".lyst.co.uk")
  ) {
    return parseLystProducts(options);
  }

  if (
    hostname === "8division.com" ||
    hostname.endsWith(".8division.com") ||
    hostname === "sculpstore.com" ||
    hostname.endsWith(".sculpstore.com")
  ) {
    return parseCafe24Products(options);
  }

  return [];
}
