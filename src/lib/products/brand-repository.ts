import { BRANDS } from "@/constants/brands";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface BrandRecord {
  slug: string;
  englishName: string;
  koreanName: string | null;
  aliases: string[];
  isActive: boolean;
  addedBy: string | null;
  createdAt: string | null;
}

interface BrandRow {
  slug: string;
  english_name: string;
  korean_name: string | null;
  aliases: string[] | null;
  is_active: boolean;
  added_by: string | null;
  created_at: string;
}

/*
 * The seed list ships with the code so a fresh database — or one where
 * the brands table has not been created yet — still collects products.
 */
const SEED_BRANDS: BrandRecord[] = BRANDS.map((brand) => ({
  slug: brand.slug,
  englishName: brand.englishName,
  koreanName: brand.koreanName,
  aliases: [...brand.aliases],
  isActive: true,
  addedBy: "seed",
  createdAt: null,
}));

function isMissingTable(error: { code?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205";
}

function toRecord(row: BrandRow): BrandRecord {
  return {
    slug: row.slug,
    englishName: row.english_name,
    koreanName: row.korean_name,
    aliases: row.aliases ?? [],
    isActive: row.is_active,
    addedBy: row.added_by,
    createdAt: row.created_at,
  };
}

/*
 * Every tracked brand. Falls back to the seed list when the table is
 * missing or empty so collection never silently stops.
 */
export async function getBrands(
  options?: { includeInactive?: boolean },
): Promise<BrandRecord[]> {
  try {
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from("brands")
      .select(
        "slug, english_name, korean_name, aliases, is_active, added_by, created_at",
      )
      .order("slug", { ascending: true });

    if (!options?.includeInactive) {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;

    if (error) {
      if (!isMissingTable(error)) {
        console.error("Brand lookup failed:", {
          code: error.code,
          message: error.message,
        });
      }

      return SEED_BRANDS;
    }

    const rows = (data ?? []) as BrandRow[];

    return rows.length > 0 ? rows.map(toRecord) : SEED_BRANDS;
  } catch (error) {
    console.error("Brand lookup error:", error);

    return SEED_BRANDS;
  }
}

/*
 * Copy the shipped list into the table. Existing rows are left alone,
 * so this is safe to call repeatedly.
 */
export async function seedBrands(): Promise<number> {
  const supabase = getSupabaseAdmin();

  const rows = SEED_BRANDS.map((brand) => ({
    slug: brand.slug,
    english_name: brand.englishName,
    korean_name: brand.koreanName,
    aliases: brand.aliases,
    is_active: true,
    added_by: "seed",
  }));

  const { error } = await supabase
    .from("brands")
    .upsert(rows, { onConflict: "slug", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Unable to seed brands: ${error.message}`);
  }

  return rows.length;
}

/*
 * Retailers punctuate brand names inconsistently — "C.P. Company" is
 * also written "CP Company" and "C.P.Company". Matching only the name
 * as typed would miss most listings, so expand it into the spellings
 * that actually appear.
 */
export function expandAliases(name: string): string[] {
  const trimmed = name.trim().toUpperCase();

  if (!trimmed) {
    return [];
  }

  const withoutPunctuation = trimmed
    .replace(/[.'’&]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const collapsed = withoutPunctuation.replace(/\s+/g, "");

  return Array.from(
    new Set(
      [trimmed, withoutPunctuation, collapsed].filter(
        (value) => value.length >= 2,
      ),
    ),
  );
}

export function toBrandSlug(value: string): string {
  return value
    .normalize("NFKD")
    // Drop combining accents so "AIMÉ" and "AIME" slug identically.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
