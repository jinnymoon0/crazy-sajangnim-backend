import { describe, expect, it } from "vitest";

import { inferCategory } from "@/lib/products/infer-category";

describe("plain cases", () => {
  it.each([
    ["Stone Island Down Jacket", "outerwear"],
    ["Lemaire Wool Cardigan", "knitwear"],
    ["Needles Track Pant", "pants"],
    ["Kapital Denim Shorts", "shorts"],
    ["Nike Air Force 1 Sneakers", "shoes"],
    ["Auralee Silk Dress", "dresses"],
    ["Comoli Pleated Skirt", "skirts"],
    ["Porter Tote Bag", "bags"],
    ["Bape Camo Cap", "hats"],
  ])("files %s under %s", (name, slug) => {
    expect(inferCategory(name)).toBe(slug);
  });
});

describe("the order the rules are tried in", () => {
  /*
   * Several rules can match one title, so the order decides. These are
   * the pairs that actually overlap — each would land somewhere else if
   * the list were reordered.
   */
  it("reads a sweatshirt as a sweatshirt, not a shirt", () => {
    expect(inferCategory("Champion Reverse Weave Sweatshirt")).toBe(
      "sweatshirts",
    );
  });

  it("reads a hoodie as a sweatshirt, not outerwear", () => {
    expect(inferCategory("Stussy Pullover Hoodie")).toBe("sweatshirts");
  });

  it("reads a t-shirt as a t-shirt, not a shirt", () => {
    expect(inferCategory("Comme des Garcons Play T-Shirt")).toBe("t-shirts");
  });

  it("reads a shirt jacket as outerwear rather than a shirt", () => {
    expect(inferCategory("Kapital Shirt Jacket")).toBe("outerwear");
  });

  it("reads a knit vest as knitwear, not tops", () => {
    expect(inferCategory("Auralee Knit Vest")).toBe("knitwear");
  });
});

describe("when nothing matches", () => {
  it("falls back to etc rather than guessing", () => {
    expect(inferCategory("Mattress Cover 4 Colors")).toBe("etc");
  });

  it("handles an empty name", () => {
    expect(inferCategory("")).toBe("etc");
  });
});

describe("Korean titles", () => {
  /*
   * Half the catalog is Korean storefronts, so the rules have to read
   * Korean product names, not only English ones.
   */
  it.each([
    ["니트 베스트", "knitwear"],
    ["와이드 팬츠", "pants"],
    ["반팔 티셔츠", "t-shirts"],
  ])("files %s under %s", (name, slug) => {
    expect(inferCategory(name)).toBe(slug);
  });
});
