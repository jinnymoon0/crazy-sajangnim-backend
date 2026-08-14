import { describe, expect, it } from "vitest";

import { readGender, resolveGender } from "@/lib/products/gender";

/*
 * The cases here are real listings taken from the live catalogue, kept
 * because each one was wrong at some point rather than because it is a
 * tidy example.
 */
describe("readGender", () => {
  it("does not find a man inside a brand name", () => {
    /*
     * The bug that started this: "human" contains "man", so every
     * HUMAN MADE listing was menswear whatever it actually was.
     */
    expect(readGender("Human Made Dog Overalls Work Shirt")).toBeNull();
    expect(readGender("Human Made Half Zip Logo Sweatshirt")).toBeNull();
  });

  it("does not find a man inside ordinary words", () => {
    for (const title of [
      "Mandarin Collar Shirt",
      "Wool Manteau Coat",
      "Romance Print Tee",
      "Permanent Press Trousers",
      "Salamander Leather Boots",
      "Commander Cargo Pants",
    ]) {
      expect(readGender(title), title).toBeNull();
    }
  });

  it("reads an explicit gender however it is written", () => {
    expect(readGender("Women's Wool Coat")?.gender).toBe("WOMEN");
    expect(readGender("WOMENS WOOL COAT")?.gender).toBe("WOMEN");
    expect(readGender("womenswear-jackets")?.gender).toBe("WOMEN");
    expect(readGender("여성 니트 가디건")?.gender).toBe("WOMEN");
    expect(readGender("메이즈 스택 인젝스 우먼스 - 블랙")?.gender).toBe("WOMEN");

    expect(readGender("Men's Wool Coat")?.gender).toBe("MEN");
    expect(readGender("menswear-jackets")?.gender).toBe("MEN");
    expect(readGender("남성 코트")?.gender).toBe("MEN");
  });

  it("does not read 'men' out of 'women'", () => {
    /* The reason the old lists needed literal spaces around " men ". */
    expect(readGender("Women's Jacket")?.gender).toBe("WOMEN");
    expect(readGender("Womens Knit")?.gender).toBe("WOMEN");
    expect(readGender("Female Fit Tee")?.gender).toBe("WOMEN");
  });

  it("sees a garment inside a compound word", () => {
    /* Both of these were sitting in menswear on the live site. */
    expect(readGender("SATIN LOW-WAIST MINISKIRT_ BLACK")?.gender).toBe("WOMEN");
    expect(readGender("wool silk suiting straight sailorskirt")?.gender).toBe(
      "WOMEN",
    );
    expect(readGender("Pleated Overskirt")?.gender).toBe("WOMEN");
    expect(readGender("코튼 미니 스커트")?.gender).toBe("WOMEN");
  });

  it("keeps menswear that merely sounds like womenswear", () => {
    /* "dress" is in all of these, and none of them is a dress. */
    for (const title of [
      "Oxford Dress Shirt",
      "Wool Dress Pants",
      "Leather Dress Shoes",
      "Dress Socks Three Pack",
      /* All three of these are real listings that the first attempt at
       * this fix moved into womenswear. */
      "adidas x Willy Chavarria Jabbar Dress Sneaker",
      "adidas x Willy Chavarria Dress Twill Track Pant",
      "릴랙스드 레이디 럭 티셔츠 미스트",
    ]) {
      expect(readGender(title), title).toBeNull();
    }

    /* And an address is not a dress. */
    expect(readGender("Address Book Leather Case")).toBeNull();
  });

  it("still recognises a real dress", () => {
    expect(readGender("Cotton Sundress")?.gender).toBe("WOMEN");
    expect(readGender("Silk Slip Dress")?.gender).toBe("WOMEN");
    expect(readGender("Linen Wrap Dress")?.gender).toBe("WOMEN");
    expect(readGender("Pleated Midi Dress")?.gender).toBe("WOMEN");
    expect(readGender("Floral Dresses")?.gender).toBe("WOMEN");
    expect(readGender("플리츠 원피스")?.gender).toBe("WOMEN");
  });

  it("says nothing when a listing names both", () => {
    /* A shop's own "men's and women's sale" page serves neither. */
    expect(readGender("Men's and Women's Sale")).toBeNull();
    expect(readGender("남성 여성 공용 티셔츠")).toBeNull();
  });

  it("says nothing about an ordinary listing", () => {
    for (const title of [
      "Nanamica Chino Jacket - Khaki",
      "Comme des Garçons Wallet SA2100DP",
      "Auralee Light Cotton Wool Viyella Cargo Pants",
      "STUSSY S Box Zip Hoodie - Black",
    ]) {
      expect(readGender(title), title).toBeNull();
    }
  });
});

describe("resolveGender", () => {
  it("keeps the source's belief when the text does not say", () => {
    expect(resolveGender("Chino Jacket", "MEN")).toBe("MEN");
    expect(resolveGender("Chino Jacket", "UNISEX")).toBe("UNISEX");
  });

  it("overrules the source when the text is unambiguous", () => {
    /*
     * The failure people actually see. A brand store crawl defaults to
     * UNISEX, and the catalogue shows UNISEX in both segments, so a
     * skirt nobody classified appeared in menswear.
     */
    expect(resolveGender("SATIN LOW-WAIST MINISKIRT", "UNISEX")).toBe("WOMEN");
    expect(resolveGender("Women's Wool Coat", "MEN")).toBe("WOMEN");
    expect(resolveGender("Men's Wool Coat", "WOMEN")).toBe("MEN");
  });
});
