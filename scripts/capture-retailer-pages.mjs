import { mkdir, writeFile } from "node:fs/promises";

const pages = [
  {
    name: "lyst-auralee-women",
    url: "https://www.lyst.com/shop/auralee-clothing/",
  },
  {
    name: "lyst-lemaire-women",
    url: "https://www.lyst.com/shop/lemaire-clothing/",
  },
  {
    name: "eightdivision-needles",
    url: "https://8division.com/category/needles/207/",
  },
  {
    name: "sculpstore-needles",
    url: "https://sculpstore.com/category/needles/189/",
  },
  {
    name: "ssfshop-lemaire",
    url: "https://www.ssfshop.com/LEMAIRE/main?brandShopNo=BDMA07A39&brndShopId=ECBLR",
  },
];

await mkdir("retailer-samples", {
  recursive: true,
});

for (const page of pages) {
  console.log(`Fetching ${page.name}...`);

  try {
    const response = await fetch(page.url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
        "User-Agent":
          process.env.COLLECTOR_USER_AGENT ??
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });

    const html = await response.text();

    const output =
      `retailer-samples/${page.name}.html`;

    await writeFile(output, html, "utf8");

    console.log(
      [
        `Saved ${output}`,
        `status=${response.status}`,
        `bytes=${Buffer.byteLength(html)}`,
        `finalUrl=${response.url}`,
      ].join(" | "),
    );
  } catch (error) {
    console.error(
      `Failed ${page.name}:`,
      error instanceof Error
        ? error.message
        : error,
    );
  }
}
