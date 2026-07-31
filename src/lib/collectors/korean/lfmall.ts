import type {
  KoreanRetailerCollector,
} from "../types";
import { KOREAN_RETAILERS } from "./config";

const retailer = KOREAN_RETAILERS.lfmall;

export const lfMallCollector: KoreanRetailerCollector =
  {
    sourceName: retailer.name,
    sourceSlug: retailer.slug,
    baseUrl: retailer.baseUrl,

    async collect() {
      /*
       * Activate only after identifying LFmall's
       * public product endpoint or obtaining a feed.
       */
      return [];
    },
  };
