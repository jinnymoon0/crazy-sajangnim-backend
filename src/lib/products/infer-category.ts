import type { CategorySlug } from "@/constants/categories";

type ProductCategory = Exclude<CategorySlug, "all">;

/*
 * Read in order, first match wins, so the narrow garment has to be
 * asked about before the broad one. "T-Shirt" and "Sweatshirt" both
 * contain "shirt", and "Dress Shirt" contains "dress" — each of those
 * belongs to the earlier rule rather than the later one.
 *
 * The same ordering settles two others: trousers are asked about before
 * shoes so a bootcut jean is not footwear, and shoes before dresses so
 * a dress shoe is not a dress.
 */
const CATEGORY_RULES: Array<{
  category: ProductCategory;
  keywords: string[];
}> = [
  {
    category: "sweatshirts",
    keywords: [
      "sweatshirt",
      "sweat shirt",
      "hoodie",
      "hoody",
      "hooded sweat",
      "crewneck",
      "crew neck sweat",
      "후드",
      "맨투맨",
      "스웨트셔츠",
      "후디",
    ],
  },
  {
    category: "t-shirts",
    keywords: ["t-shirt", "t shirt", "tshirt", "tee", "티셔츠", "반팔티"],
  },
  {
    category: "shirts",
    keywords: [
      "shirt",
      "overshirt",
      "blouse",
      "polo",
      "셔츠",
      "블라우스",
      "폴로",
    ],
  },
  {
    category: "knitwear",
    keywords: [
      "knit",
      "sweater",
      "cardigan",
      "pullover",
      "jumper",
      "turtleneck",
      "니트",
      "스웨터",
      "가디건",
      "풀오버",
      "터틀넥",
    ],
  },
  {
    category: "outerwear",
    keywords: [
      "coat",
      "jacket",
      "blazer",
      "parka",
      "vest",
      "gilet",
      "blouson",
      "anorak",
      "windbreaker",
      "puffer",
      "track top",
      "트랙탑",
      "코트",
      "재킷",
      "자켓",
      "점퍼",
      "아우터",
      "블루종",
      "패딩",
      "바람막이",
      "베스트",
    ],
  },
  {
    category: "tops",
    keywords: [
      "tank top",
      "tank",
      "camisole",
      "sleeveless",
      "bodysuit",
      "나시",
      "캐미솔",
      "슬리브리스",
      "민소매",
    ],
  },
  {
    category: "shorts",
    keywords: ["shorts", "short pant", "쇼츠", "반바지"],
  },
  {
    category: "pants",
    keywords: [
      "pants",
      "pant",
      "trouser",
      "jeans",
      "denim",
      "slacks",
      "chino",
      "legging",
      "jogger",
      "팬츠",
      "바지",
      "데님",
      "청바지",
      "슬랙스",
      "조거",
      "레깅스",
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
      "slip-on",
      "slip on",
      /*
       * Korean listings often name only the silhouette — "삼바 OG",
       * "핸드볼 스페지알" — with nothing that says footwear. These are
       * the lines that actually turn up in the catalog; expect to add
       * to this as the shops carry new ones.
       */
      "삼바",
      "가젤",
      "캠퍼스",
      "슈퍼스타",
      "스탠스미스",
      "스피드캣",
      "나이트로",
      "보메로",
      "페가수스",
      "핸드볼",
      "스페지알",
      "디비에이트",
      "에어맥스",
      "에어 맥스",
      "에어포스",
      "덩크",
      "모스트로",
    ],
  },
  {
    category: "dresses",
    keywords: ["dress", "gown", "원피스", "드레스"],
  },
  {
    category: "skirts",
    keywords: ["skirt", "스커트", "치마"],
  },
  {
    category: "bags",
    keywords: [
      "bag",
      "tote",
      "backpack",
      "rucksack",
      "pouch",
      "satchel",
      "duffle",
      "holdall",
      "가방",
      "백팩",
      "파우치",
      "토트",
    ],
  },
  {
    category: "hats",
    keywords: [
      "hat",
      "cap",
      "beanie",
      "bucket",
      "balaclava",
      "모자",
      "캡",
      "비니",
      "버킷",
    ],
  },
  {
    category: "accessories",
    keywords: [
      "belt",
      "wallet",
      "cardholder",
      "card case",
      "scarf",
      "sock",
      "glove",
      "sunglasses",
      "eyewear",
      "glasses",
      "jewellery",
      "jewelry",
      "necklace",
      "bracelet",
      "earring",
      "keyring",
      "keychain",
      "벨트",
      "지갑",
      "스카프",
      "양말",
      "장갑",
      "머플러",
      "선글라스",
      "안경",
      "목걸이",
      "팔찌",
      "반지",
      "귀걸이",
      "키링",
    ],
  },
];

/*
 * Place a product from whatever text the retailer gives — usually the
 * title, sometimes with the department alongside it.
 *
 * Anything the rules cannot place goes to "etc" rather than to a real
 * category. A guess parked in Accessories is worse than an honest
 * shrug: it makes that shelf untrustworthy for the things that do
 * belong on it.
 */
export function inferCategory(productName: string): ProductCategory {
  const normalized = productName.toLowerCase();

  const match = CATEGORY_RULES.find(({ keywords }) =>
    keywords.some((keyword) => normalized.includes(keyword.toLowerCase())),
  );

  return match?.category ?? "etc";
}
