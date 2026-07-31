import * as cheerio from "cheerio";

export interface JsonLdOffer {
  price?: string | number;
  lowPrice?: string | number;
  highPrice?: string | number;
  priceCurrency?: string;
  availability?: string;
  url?: string;
}

export interface JsonLdProduct {
  "@type"?: string | string[];
  sku?: string;
  productID?: string;
  name?: string;

  brand?:
    | string
    | {
        name?: string;
      };

  image?: string | string[];

  offers?:
    | JsonLdOffer
    | JsonLdOffer[];

  url?: string;
}

function flattenJsonLd(
  value: unknown,
): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap(flattenJsonLd);
  }

  if (
    value &&
    typeof value === "object" &&
    "@graph" in value
  ) {
    const graph = (
      value as { "@graph"?: unknown[] }
    )["@graph"];

    return flattenJsonLd(graph ?? []);
  }

  return [value];
}

export function extractJsonLdProducts(
  html: string,
): JsonLdProduct[] {
  const $ = cheerio.load(html);
  const products: JsonLdProduct[] = [];

  $('script[type="application/ld+json"]').each(
    (_, element) => {
      const text = $(element).text().trim();

      if (!text) {
        return;
      }

      try {
        const parsed = JSON.parse(text);

        for (const item of flattenJsonLd(parsed)) {
          if (
            !item ||
            typeof item !== "object"
          ) {
            continue;
          }

          const candidate =
            item as JsonLdProduct;

          const types = Array.isArray(
            candidate["@type"],
          )
            ? candidate["@type"]
            : [candidate["@type"]];

          if (types.includes("Product")) {
            products.push(candidate);
          }
        }
      } catch {
        // Ignore invalid third-party JSON-LD blocks.
      }
    },
  );

  return products;
}
