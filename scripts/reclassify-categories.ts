/*
 * Re-place every stored product under the current category rules.
 *
 * The rules are applied when a product is collected, so changing them
 * leaves everything already in the catalog where it was. This walks the
 * catalog once and moves what the rules now place differently.
 *
 *   npx tsx scripts/reclassify-categories.ts          # report only
 *   npx tsx scripts/reclassify-categories.ts --apply  # write changes
 */

import { inferCategory } from "../src/lib/products/infer-category";
import { getSupabaseAdmin } from "../src/lib/supabase/admin";

const PAGE_SIZE = 1000;

interface Row {
  product_key: string;
  product_name: string;
  category_slug: string;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const supabase = getSupabaseAdmin();

  const rows: Row[] = [];

  // A response is capped at a thousand rows, so read it a page at a time.
  for (let page = 0; ; page += 1) {
    const from = page * PAGE_SIZE;

    const { data, error } = await supabase
      .from("product_catalog")
      .select("product_key, product_name, category_slug")
      .order("product_key")
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    rows.push(...((data ?? []) as Row[]));

    if (!data || data.length < PAGE_SIZE) {
      break;
    }
  }

  const moves = new Map<string, number>();
  const changed: Array<{ key: string; to: string }> = [];

  let kept = 0;

  for (const row of rows) {
    const next = inferCategory(row.product_name);

    if (next === row.category_slug) {
      continue;
    }

    /*
     * A product is placed when it is collected, from the title plus
     * whatever else the retailer gives — a department, a breadcrumb.
     * Only the title survives in the catalog, so re-reading it can come
     * up empty where the original had more to go on. Never demote a
     * product that already sits somewhere definite.
     *
     * Accessories is the exception: it used to be the fallback, so what
     * landed there unmatched belongs in etc.
     */
    if (next === "etc" && row.category_slug !== "accessories") {
      kept += 1;

      continue;
    }

    changed.push({ key: row.product_key, to: next });

    const move = `${row.category_slug} -> ${next}`;

    moves.set(move, (moves.get(move) ?? 0) + 1);
  }

  console.log(
    `${rows.length} products, ${changed.length} to move, ${kept} left where they are\n`,
  );

  for (const [move, count] of [...moves.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${move}`);
  }

  if (!apply) {
    console.log("\nReport only. Pass --apply to write these.");

    return;
  }

  let written = 0;

  for (const { key, to } of changed) {
    const { error } = await supabase
      .from("product_catalog")
      .update({ category_slug: to })
      .eq("product_key", key);

    if (error) {
      console.error(`  ${key}: ${error.message}`);

      continue;
    }

    written += 1;

    if (written % 250 === 0) {
      console.log(`  ${written}/${changed.length}`);
    }
  }

  console.log(`\n${written} moved.`);
}

main();
