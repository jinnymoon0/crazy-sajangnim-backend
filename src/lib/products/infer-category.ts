import type { CategorySlug } from "@/constants/categories";

type ProductCategory = Exclude<CategorySlug, "all">;

const CATEGORY_RULES: Array<{
  category: ProductCategory;
  keywords: string[];
}> = [
  {
    category: "outerwear",
    keywords: [
      "coat",
      "jacket",
      "blazer",
      "parka",
      "vest",
      "blouson",
      "anorak",
      "windbreaker",
      "코트",
      "재킷",
      "자켓",
      "점퍼",
      "아우터",
      "블루종",
    ],
  },
  {
    category: "shirts",
    keywords: [
      "shirt",
      "overshirt",
      "blouse",
      "셔츠",
      "블라우스",
    ],
  },
  {
    category: "knitwear",
    keywords: [
      "knit",
      "sweater",
      "cardigan",
      "pullover",
      "니트",
      "스웨터",
      "가디건",
      "풀오버",
    ],
  },
  {
    category: "t-shirts",
    keywords: [
      "t-shirt",
      "t shirt",
      "tee",
      "sweatshirt",
      "hoodie",
      "티셔츠",
      "후드",
      "스웨트",
      "맨투맨",
    ],
  },
  {
    category: "pants",
    keywords: [
      "pants",
      "trousers",
      "jeans",
      "denim",
      "track pant",
      "slacks",
      "chino",
      "sweatpant",
      "팬츠",
      "바지",
      "데님",
      "청바지",
      "슬랙스",
    ],
  },
  {
    category: "shorts",
    keywords: ["shorts", "쇼츠", "반바지"],
  },
  {
    category: "bags",
    keywords: [
      "bag",
      "tote",
      "backpack",
      "pouch",
      "가방",
      "백",
      "파우치",
    ],
  },
  {
    category: "shoes",
    keywords: [
      "shoe",
      "sneaker",
      "boot",
      "loafer",
      "sandal",
      "slipper",
      "mule",
      "derby",
      "derbies",
      "moccasin",
      "espadrille",
      "clog",
      "trainer",
      "footwear",
      "신발",
      "스니커",
      "부츠",
      "로퍼",
      "샌들",
      "슬리퍼",
      "뮬",
      "더비",
      "구두",
      "운동화",
    ],
  },
  {
    category: "accessories",
    keywords: [
      "hat",
      "cap",
      "belt",
      "wallet",
      "scarf",
      "socks",
      "모자",
      "벨트",
      "지갑",
      "스카프",
      "양말",
    ],
  },
];

export function inferCategory(
  productName: string,
): ProductCategory {
  const normalized = productName.toLowerCase();

  const match = CATEGORY_RULES.find(({ keywords }) =>
    keywords.some((keyword) =>
      normalized.includes(keyword.toLowerCase()),
    ),
  );

  return match?.category ?? "accessories";
}
