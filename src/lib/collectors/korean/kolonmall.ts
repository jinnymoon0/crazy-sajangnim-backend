import type {
  KoreanRetailerCollector,
} from "../types";
import { fetchPublicHtml } from "../utils/html";
import { parseJsonLdProducts } from "../utils/product-json-ld";
import { KOREAN_RETAILERS } from "./config";

const retailer = KOREAN_RETAILERS.kolonmall;

const BRAND_QUERIES = [
  "AURALEE",
  "BEAMS PLUS",
  "COMOLI",
  "DANTON",
  "KAMIYA",
  "KAPITAL",
  "LEMAIRE",
  "NEEDLES",
];

export const kolonMallCollector: KoreanRetailerCollector =
  {
    sourceName: retailer.name,
    sourceSlug: retailer.slug,
    baseUrl: retailer.baseUrl,

    async collect(requestedGender) {
      const results = await Promise.allSettled(
        BRAND_QUERIES.map(async (brand) => {
          /*
           * Search URL parameters may need adjustment
           * after inspecting KOLON Mall's current
           * network requests.
           */
          const searchUrl =
            `${retailer.baseUrl}/Search?` +
            new URLSearchParams({
              searchWord: brand,
            }).toString();

          const html =
            await fetchPublicHtml(searchUrl);

          return parseJsonLdProducts(html, {
            sourceName: retailer.name,
            sourcePageUrl: searchUrl,
            baseUrl: retailer.baseUrl,
            requestedGender,
          });
        }),
      );

      return results.flatMap((result) =>
        result.status === "fulfilled"
          ? result.value
          : [],
      );
    },
  };
