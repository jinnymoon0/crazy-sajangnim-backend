import type { Gender } from "@/types/product";

/*
 * One place that decides whether a listing is menswear or womenswear.
 *
 * There were two, and they disagreed. The copy used by the retailer
 * crawlers tested for the bare substring "man", which is inside "human"
 * — every HUMAN MADE listing was filed as menswear on the strength of
 * the brand's name — and inside "mandarin", "manteau" and "romance".
 * The copy used by the direct crawlers had the boundaries right but
 * could not see a garment inside a compound word, so MINISKIRT and
 * sailorskirt were not skirts to it.
 *
 * The second fault is the one people notice, because of what happens to
 * a listing nobody can classify: it is stored UNISEX, and the read path
 * deliberately surfaces UNISEX in both segments. A genuinely unisex
 * t-shirt belongs in both. A skirt the classifier failed to recognise
 * also went to both — which is womenswear appearing in menswear, from a
 * missing word rather than a wrong one.
 */

/*
 * Word boundaries do the work that hand-written spacing used to.
 *
 * \bmen\b cannot match inside "women": the character before the "m" is
 * "o", so there is no boundary there. The same is true of \bmale\b in
 * "female". That is what the old " men " with literal spaces was
 * reaching for, except that it also failed on "men's" at the end of a
 * title and on "menswear-jackets" before the separators were stripped.
 */
const WOMEN_WORDS = /\b(?:wom[ae]n|womens|womenswear|women's|ladies|female|misses)\b/;
const MEN_WORDS = /\b(?:men|mens|menswear|men's|male|gents|gentlemen)\b/;

/* Korean has no word boundaries; these strings are unambiguous as-is. */
/*
 * 레이디 is deliberately absent. It is a loan word that turns up in
 * product names as a phrase rather than an audience — "릴랙스드 레이디 럭
 * 티셔츠" is a t-shirt called Lady Luck, and it was being moved into
 * womenswear on the strength of it.
 */
const WOMEN_KO = /여성|여자|우먼/;
const MEN_KO = /남성|남자|맨즈|멘즈/;

/*
 * Garments that identify womenswear on their own, matched so that a
 * compound still counts: a MINISKIRT and a sailorskirt are skirts.
 *
 * The leading boundary is dropped only where the ending is decisive.
 * "dress" keeps a guard against "address", and against the dress shirts,
 * dress pants and dress shoes that are menswear more often than not.
 */
const WOMEN_GARMENTS: Array<{ name: string; pattern: RegExp }> = [
  { name: "skirt", pattern: /(?<!out)skirts?\b/ },
  /*
   * "dress" is an adjective at least as often as it is a garment, and
   * the live catalogue proves it: a Jabbar Dress Sneaker and a Dress
   * Twill Track Pant are menswear. A blocklist of the nouns that may
   * follow it cannot be finished — shirt, pant, shoe, sock, boot,
   * sneaker, twill, and whatever a brand names next season.
   *
   * So the word only counts where it is doing a noun's work: inside a
   * compound, after a cut that only dresses have, or at the end of the
   * title with nothing following it to modify.
   *
   * This misses "Dress in Black" and similar, on purpose. Missing a
   * dress leaves it in both segments, which is where an unclassified
   * listing sits today; a false dress takes a men's sneaker out of
   * menswear altogether. The second mistake is the visible one.
   */
  { name: "dress", pattern: /\w+(?<!ad)dress(?:es)?\b/ },
  {
    name: "dress",
    pattern:
      /\b(?:slip|wrap|midi|maxi|mini|shift|sheath|smock|sun|cami|knit|tank)\s+dress(?:es)?\b/,
  },
  { name: "dress", pattern: /\bdress(?:es)?\s*$/ },
  { name: "blouse", pattern: /blouses?\b/ },
  { name: "gown", pattern: /gowns?\b/ },
  { name: "bralette", pattern: /bralettes?\b/ },
  { name: "camisole", pattern: /camisoles?\b/ },
  { name: "corset", pattern: /corsets?\b/ },
  { name: "bodysuit", pattern: /bodysuits?\b/ },
  { name: "leggings", pattern: /\bleggings\b/ },
  { name: "strapless piece", pattern: /\bstrapless\b/ },
  { name: "lingerie", pattern: /\blingerie\b/ },
  { name: "panties", pattern: /\bpanties\b/ },
  { name: "heels", pattern: /\bheels\b|\bheeled\b/ },
  { name: "여성복", pattern: /원피스|스커트|블라우스|치마|레깅스/ },
];

export type GenderVerdict = {
  gender: Gender;
  /* Why, so a correction can be logged in terms a person can check. */
  reason: string;
};

function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[/_\-–—.,()[\]]+/g, " ")} `;
}

/*
 * A confident reading of the text, or null when it does not say.
 *
 * Null is not a failure: most listings genuinely do not state a gender,
 * and the caller has a source-level default that is usually right. This
 * only speaks when the words are unambiguous.
 */
export function readGender(text: string): GenderVerdict | null {
  const normalized = normalize(text);

  const saysWomen = WOMEN_WORDS.test(normalized) || WOMEN_KO.test(normalized);
  const saysMen = MEN_WORDS.test(normalized) || MEN_KO.test(normalized);

  /*
   * Both, which a shop's own "men's and women's" category pages say, and
   * which no single answer serves. Left for the caller's default.
   */
  if (saysWomen && saysMen) {
    return null;
  }

  if (saysWomen) {
    return { gender: "WOMEN", reason: "the title says womenswear" };
  }

  if (saysMen) {
    return { gender: "MEN", reason: "the title says menswear" };
  }

  const garment = WOMEN_GARMENTS.find(({ pattern }) => pattern.test(normalized));

  if (garment) {
    return { gender: "WOMEN", reason: `it is a ${garment.name}` };
  }

  return null;
}

/*
 * What to store, given what the source believed.
 *
 * The text wins when it is unambiguous. A collector's belief is usually
 * the storefront it happened to be crawling, which is right for most of
 * a page and wrong for the womenswear on it.
 */
export function resolveGender(text: string, fallback: Gender): Gender {
  return readGender(text)?.gender ?? fallback;
}
