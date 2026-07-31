import { searchSearxng } from "@/lib/search/searxng";

export interface BrandCandidate {
  englishName: string;
  koreanName: string | null;
  aliases: string[];
  confidence: number;
  sourceUrl: string | null;
  sourceTitle: string | null;
}

/*
 * Latin letters only (accents allowed) means the admin already typed a
 * name the retailers will recognise, so no lookup is needed.
 */
export function isLatinName(value: string): boolean {
  return /^[\p{Script=Latin}\p{M}0-9&'’.\-\s+]+$/u.test(value.trim());
}

const NOISE_WORDS = new Set([
  "official",
  "site",
  "website",
  "online",
  "store",
  "shop",
  "sale",
  "brand",
  "clothing",
  "fashion",
  "korea",
  "usa",
  "kr",
  "us",
  "the",
  "and",
  "buy",
  "new",
  "collection",
  "home",
]);

/*
 * Pull plausible brand names out of a search result title. Titles look
 * like "LEMAIRE | Official Online Store" or "르메르(LEMAIRE) 공식",
 * so the Latin run before a separator is usually the brand.
 */
function extractLatinNames(title: string): string[] {
  const names: string[] = [];

  // Anything inside brackets, e.g. 르메르(LEMAIRE).
  for (const match of title.matchAll(/[([]([^)\]]{2,40})[)\]]/g)) {
    names.push(match[1]);
  }

  // Segments split on common title separators.
  for (const segment of title.split(/[|·–—:/,]|\s-\s/)) {
    names.push(segment);
  }

  return names
    .map((value) =>
      value
        .replace(/[^\p{Script=Latin}\p{M}0-9&'’.\-\s+]/gu, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((value) => {
      if (value.length < 2 || value.length > 40) {
        return false;
      }

      const words = value.toLowerCase().split(/\s+/);

      // Reject titles that are mostly generic words.
      const meaningful = words.filter((word) => !NOISE_WORDS.has(word));

      return meaningful.length > 0 && meaningful.length <= 4;
    })
    .map((value) =>
      value
        .split(/\s+/)
        .filter((word) => !NOISE_WORDS.has(word.toLowerCase()))
        .join(" ")
        .trim(),
    )
    .filter((value) => value.length >= 2);
}

/*
 * Search the web for a brand written in any language and return the
 * English names it is sold under, best guess first. The admin picks
 * one, so this only has to surface good candidates — not decide.
 */
export async function findBrandCandidates(
  query: string,
): Promise<BrandCandidate[]> {
  const trimmed = query.trim();

  if (!trimmed) {
    return [];
  }

  const scores = new Map<string, BrandCandidate>();

  const searches = [
    `${trimmed} 브랜드 공식`,
    `${trimmed} brand official site`,
  ];

  for (const search of searches) {
    let results;

    try {
      const response = await searchSearxng(search, { language: "ko-KR" });

      results = response.results.slice(0, 12);
    } catch (error) {
      console.error("Brand lookup search failed:", error);

      continue;
    }

    for (const [index, result] of results.entries()) {
      const title = result.title ?? "";

      for (const name of extractLatinNames(title)) {
        const key = name.toUpperCase();

        const existing = scores.get(key);

        // Earlier results and repeat sightings score higher.
        const gain = Math.max(1, 12 - index);

        if (existing) {
          existing.confidence += gain;

          continue;
        }

        scores.set(key, {
          englishName: key,
          koreanName: isLatinName(trimmed) ? null : trimmed,
          aliases: Array.from(
            new Set([key, name, trimmed].filter(Boolean)),
          ),
          confidence: gain,
          sourceUrl: result.url ?? null,
          sourceTitle: title || null,
        });
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
}
