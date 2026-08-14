import { resolveGender } from "@/lib/products/gender";
import type { Gender } from "@/types/product";

/*
 * Kept as a name the search-driven collectors already call, now backed
 * by the one classifier in gender.ts.
 *
 * What it used to be was a second, weaker copy of that logic: it tested
 * for the bare substring "man", which is inside "human", so every HUMAN
 * MADE listing was filed as menswear on the strength of the brand name,
 * and "mens" matched inside "womens" backwards only by luck of the
 * check order. It also had no notion of a garment, so a skirt with no
 * gender word in its title fell through to whichever segment was being
 * searched.
 *
 * The fallback is unchanged and still matters: search results usually
 * omit gender, and the query that found them is the best guess left.
 */
export function inferGender(
  text: string,
  requestedGender: Exclude<Gender, "UNISEX">,
): Gender {
  return resolveGender(text, requestedGender);
}
