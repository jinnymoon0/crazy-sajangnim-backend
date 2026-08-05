import { beforeEach, describe, expect, it } from "vitest";

import { BRANDS } from "@/constants/brands";
import { setActiveBrands } from "@/lib/products/brand-registry";
import { inferBrand } from "@/lib/products/infer-brand";

/*
 * ON is tracked throughout. That is the point of these cases: the bug
 * was a product title matching a name that really was a tracked brand,
 * so testing with ON absent would prove nothing.
 */
function trackShippedBrandsPlusOn() {
  setActiveBrands([
    ...BRANDS.map((brand) => ({
      slug: brand.slug,
      englishName: brand.englishName,
      koreanName: brand.koreanName,
      aliases: [...brand.aliases],
      isActive: true,
      addedBy: "seed",
      createdAt: null,
    })),
    {
      slug: "on",
      englishName: "ON",
      koreanName: null,
      aliases: ["ON", "ON RUNNING"],
      isActive: true,
      addedBy: "test",
      createdAt: null,
    },
  ]);
}

beforeEach(trackShippedBrandsPlusOn);

describe("a brand name that is also an ordinary word", () => {
  /*
   * Every one of these was really filed under ON. The hyphen in
   * "Slip-On" counts as a word boundary, so a check for ON as a whole
   * word matched inside the compound.
   */
  it.each([
    "Easymoc Slip-On in Chocolate Grizzly Roughout",
    "Easymoc Slip-On in Toast Suede",
    "Vans Slip-On Reissue 98 LX Sneakers Checkerboard",
    "FOOT CAST///SLIP ON BLACK",
    "(W)  DESERT NOMAD SPECKLED HAIR ON",
  ])("does not claim %s for ON", (title) => {
    expect(inferBrand(title)).toBeNull();
  });

  it.each(["Pull On Trouser", "Zip On Liner", "Slip on Mule"])(
    "does not match the bare word in %s",
    (title) => {
      expect(inferBrand(title)).toBeNull();
    },
  );

  it("still believes the shop when it names the brand itself", () => {
    expect(inferBrand("On", { fromBrandField: true })?.slug).toBe("on");
    expect(inferBrand("On Running", { fromBrandField: true })?.slug).toBe("on");
  });

  it("does not believe a title even when it reads like a brand field", () => {
    expect(inferBrand("Vans Slip-On", { fromBrandField: false })).toBeNull();
  });
});

describe("names that are short without being words", () => {
  /*
   * The first fix keyed on length, which would have silently stopped
   * these from ever matching again.
   */
  it.each([
    ["NEEDLES Track Pant Poly Smooth", "needles"],
    ["니들스 트랙 팬츠", "needles"],
    ["CDG Play Heart Tee", "comme-des-garcons"],
    ["ALD Wool Cardigan", "aime-leon-dore"],
    ["나이키 에어포스 1", "nike"],
  ])("still matches %s", (title, slug) => {
    expect(inferBrand(title)?.slug).toBe(slug);
  });
});

describe("ordinary matching", () => {
  it("matches a plain brand name in a title", () => {
    expect(inferBrand("KAPITAL Century Denim Jacket")?.slug).toBe("kapital");
  });

  it("returns null for a title naming no tracked brand", () => {
    expect(inferBrand("Unbranded Cotton Tee")).toBeNull();
  });

  it("returns null for an empty or whitespace title", () => {
    expect(inferBrand("")).toBeNull();
    expect(inferBrand("   ")).toBeNull();
  });

  it("refuses a title naming two brands at once", () => {
    /*
     * A collaboration, or a listing page that mentions several. Either
     * way the brand is not established, and guessing would file it
     * under whichever happened to be checked first.
     */
    expect(inferBrand("NEEDLES x KAPITAL Track Pant")).toBeNull();
  });

  it("is not confused by case or by extra spacing", () => {
    expect(inferBrand("needles   track   pant")?.slug).toBe("needles");
  });

  it("matches across the punctuation retailers actually use", () => {
    expect(inferBrand("COMME DES GARCONS Shirt")?.slug).toBe(
      "comme-des-garcons",
    );
    expect(inferBrand("Comme des Garçons Shirt")?.slug).toBe(
      "comme-des-garcons",
    );
  });
});
