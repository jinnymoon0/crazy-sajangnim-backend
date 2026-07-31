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
    slug: "shirts",
    englishName: "Shirts",
    koreanName: "셔츠",
  },
  {
    slug: "knitwear",
    englishName: "Knitwear",
    koreanName: "니트",
  },
  {
    slug: "t-shirts",
    englishName: "T-Shirts",
    koreanName: "티셔츠",
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
    slug: "bags",
    englishName: "Bags",
    koreanName: "가방",
  },
  {
    slug: "shoes",
    englishName: "Shoes",
    koreanName: "신발",
  },
  {
    slug: "accessories",
    englishName: "Accessories",
    koreanName: "액세서리",
  },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];
