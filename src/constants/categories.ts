export const CATEGORIES = [
  {
    slug: "all",
    englishName: "All",
    koreanName: "전체",
  },
  {
    slug: "outerwear",
    englishName: "Outerwear",
    koreanName: "아우터",
  },
  {
    slug: "knitwear",
    englishName: "Knitwear",
    koreanName: "니트",
  },
  {
    slug: "sweatshirts",
    englishName: "Sweatshirts",
    koreanName: "맨투맨·후드",
  },
  {
    slug: "shirts",
    englishName: "Shirts",
    koreanName: "셔츠",
  },
  {
    slug: "t-shirts",
    englishName: "T-Shirts",
    koreanName: "티셔츠",
  },
  {
    slug: "tops",
    englishName: "Tops",
    koreanName: "탑",
  },
  {
    slug: "pants",
    englishName: "Pants",
    koreanName: "팬츠",
  },
  {
    slug: "shorts",
    englishName: "Shorts",
    koreanName: "반바지",
  },
  {
    slug: "skirts",
    englishName: "Skirts",
    koreanName: "스커트",
  },
  {
    slug: "dresses",
    englishName: "Dresses",
    koreanName: "원피스",
  },
  {
    slug: "shoes",
    englishName: "Shoes",
    koreanName: "신발",
  },
  {
    slug: "bags",
    englishName: "Bags",
    koreanName: "가방",
  },
  {
    slug: "hats",
    englishName: "Hats",
    koreanName: "모자",
  },
  {
    slug: "accessories",
    englishName: "Accessories",
    koreanName: "액세서리",
  },
  {
    // Everything the rules cannot place. Its own shelf, so guesses do
    // not quietly pile up inside a real category.
    slug: "etc",
    englishName: "Etc",
    koreanName: "기타",
  },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];
