import pLimit from "p-limit";
import type {
  SelectableGender,
} from "../types";
import { toProduct } from "../types";
import { kolonMallCollector } from "./kolonmall";
import { lfMallCollector } from "./lfmall";
import { okMallCollector } from "./okmall";

const collectors = [
  kolonMallCollector,
  okMallCollector,
  lfMallCollector,
];

export async function collectKoreanRetailerProducts(
  gender: SelectableGender,
) {
  const limit = pLimit(2);

  const results = await Promise.allSettled(
    collectors.map((collector) =>
      limit(() => collector.collect(gender)),
    ),
  );

  const products = results.flatMap(
    (result) =>
      result.status === "fulfilled"
        ? result.value.map(toProduct)
        : [],
  );

  return Array.from(
    new Map(
      products.map((product) => [
        [
          product.sourceName,
          product.productName,
          product.salePrice,
        ].join("|"),
        product,
      ]),
    ).values(),
  );
}
