import type {
  KoreanRetailerCollector,
} from "../types";
import { KOREAN_RETAILERS } from "./config";

const retailer = KOREAN_RETAILERS.okmall;

export const okMallCollector: KoreanRetailerCollector =
  {
    sourceName: retailer.name,
    sourceSlug: retailer.slug,
    baseUrl: retailer.baseUrl,

    async collect() {
      /*
       * Activate only after confirming the current
       * public search endpoint, robots.txt rules,
       * and permitted access terms.
       */
      return [];
    },
  };
