import { createHash } from "node:crypto";
import { inferCategory } from "@/lib/products/infer-category";
import { inferGender } from "@/lib/products/infer-gender";
import { inferBrand } from "@/lib/products/infer-brand";
import type {
  RawRetailerProduct,
  SelectableGender,
} from "../types";
import {
  extractJsonLdProducts,
  type JsonLdOffer,
} from "./json-ld";
import { absoluteUrl } from "./url";

function numberValue(
  value: string | number | undefined,
): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : null;
  }

  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/,/g, "")
    .replace(/[^\d.]/g, "");

  const parsed = Number.parseFloat(normalized);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function firstOffer(
  offer: JsonLdOffer | JsonLdOffer[] | undefined,
): JsonLdOffer | undefined {
  return Array.isArray(offer)
    ? offer[0]
    : offer;
}

export function parseJsonLdProducts(
  html: string,
  options: {
    sourceName: string;
    sourcePageUrl: string;
    baseUrl: string;
    requestedGender: SelectableGender;
  },
): RawRetailerProduct[] {
  return extractJsonLdProducts(html)
    .map((product) => {
      const title = product.name?.trim();

      if (!title) {
        return null;
      }

      const brand = inferBrand(
        [
          title,
          typeof product.brand === "string"
            ? product.brand
            : product.brand?.name,
        ]
          .filter(Boolean)
          .join(" "),
      );

      if (!brand) {
        return null;
      }

      const offers = Array.isArray(
        product.offers,
      )
        ? product.offers
        : product.offers
          ? [product.offers]
          : [];

      const prices = offers
        .flatMap((offer) => [
          numberValue(offer.price),
          numberValue(offer.lowPrice),
          numberValue(offer.highPrice),
        ])
        .filter(
          (price): price is number =>
            price !== null && price > 0,
        );

      const uniquePrices = [
        ...new Set(prices),
      ].sort((a, b) => a - b);

      /*
       * JSON-LD often exposes only one current price.
       * Keep only products where two distinct prices
       * prove an actual discount.
       */
      if (uniquePrices.length < 2) {
        return null;
      }

      const salePrice = uniquePrices[0];
      const originalPrice =
        uniquePrices[uniquePrices.length - 1];

      if (salePrice >= originalPrice) {
        return null;
      }

      const offer = firstOffer(
        product.offers,
      );

      const sourceUrl =
        absoluteUrl(
          product.url ?? offer?.url,
          options.baseUrl,
        ) ?? options.sourcePageUrl;

      const imageValue = Array.isArray(
        product.image,
      )
        ? product.image[0]
        : product.image;

      const imageUrl = absoluteUrl(
        imageValue,
        options.baseUrl,
      );

      if (!imageUrl) {
        return null;
      }

      const sourceId =
        product.sku ??
        product.productID ??
        createHash("sha256")
          .update(
            `${options.sourceName}|${title}|${sourceUrl}`,
          )
          .digest("hex")
          .slice(0, 20);

      return {
        sourceId,
        sourceName: options.sourceName,
        sourceUrl,

        title,
        brandSlug: brand.slug,
        brandName: brand.name,

        category: inferCategory(title),
        gender: inferGender(
          title,
          options.requestedGender,
        ),

        imageUrl,

        originalPrice,
        salePrice,

        isAvailable:
          !offer?.availability ||
          !offer.availability
            .toLowerCase()
            .includes("outofstock"),
      } satisfies RawRetailerProduct;
    })
    .filter(
      (
        product,
      ): product is RawRetailerProduct =>
        product !== null,
    );
}
