import type { Gender } from "@/types/product";

const WOMEN_KEYWORDS = [
  "women",
  "women's",
  "womens",
  "woman",
  "female",
  "ladies",
  "여성",
  "여자",
  "우먼",
];

const MEN_KEYWORDS = [
  " men ",
  "men's",
  "mens",
  "man",
  "male",
  "남성",
  "남자",
  "맨즈",
];

export function inferGender(
  text: string,
  requestedGender: Exclude<Gender, "UNISEX">,
): Gender {
  const normalized = ` ${text.toLowerCase()} `;

  if (
    WOMEN_KEYWORDS.some((keyword) =>
      normalized.includes(keyword),
    )
  ) {
    return "WOMEN";
  }

  if (
    MEN_KEYWORDS.some((keyword) =>
      normalized.includes(keyword),
    )
  ) {
    return "MEN";
  }

  /*
   * Shopping results frequently omit gender from the title.
   * In that case, use the gender from the search query.
   */
  return requestedGender;
}
