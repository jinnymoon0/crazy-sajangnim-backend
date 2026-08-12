/*
 * Shops worth asking about any brand, whether or not a search engine is
 * available.
 *
 * Discovery was built around a web search, and a web search needs a key
 * that costs money and expires: the Google one 403'd for days without
 * saying why, and with it gone `discoverRetailers` returns nothing, so
 * adding a brand can only ever find stock in the handful of retailers
 * already read. Five tracked brands currently have no items at all.
 *
 * But search was never doing the hard part. It proposed hostnames and
 * `verifyStockist` did the proving — that the shop actually carries the
 * brand, runs on a platform with a public catalogue, and prices in
 * dollars or won. A list proposes hostnames just as well, and unlike a
 * search engine it cannot 403, rate-limit, bill, or quietly return
 * nothing.
 *
 * So these are candidates, not claims. Nothing here is trusted: every
 * domain goes through the same verification a search result does, and a
 * shop that has closed, moved platform, or never stocked the brand is
 * dropped exactly as before. Being wrong in this list costs one request.
 *
 * It does not replace search — a curated list cannot find the boutique
 * nobody has heard of, which is what search is for. When a provider is
 * configured both run and the results merge. This is the floor, not the
 * ceiling.
 *
 * Excluded on purpose: everything in NEVER in retailer-discovery, which
 * is the shops already read another way plus the marketplaces that would
 * drown the catalogue in resale listings.
 */

/*
 * Multi-brand shops that sell into the United States and price in
 * dollars. Weighted towards Shopify, because a public products.json is
 * what makes a shop readable at all.
 */
const US_STOCKISTS: string[] = [
  "havenshop.com",
  "notre-shop.com",
  "bodega.com",
  "extrabutterny.com",
  "packershoes.com",
  "socialstatuspgh.com",
  "cncpts.com",
  "a-ma-maniere.com",
  "xhibition.co",
  "rsvpgallery.com",
  "nepenthesny.com",
  "blueowl.us",
  "lostandfoundshop.com",
  "undefeated.com",
  "kith.com",
  "slamjam.com",
  "oipolloi.com",
  "goodhoodstore.com",
  "hanon-shop.com",
  "norsestore.com",
  "urbanindustry.co.uk",
  "wellgosh.com",
  "18montrose.com",
  "antonioli.eu",
];

/*
 * Korean shops. Cafe24 dominates here and exposes a catalogue at a
 * predictable path, which is why the platform is worth detecting at all.
 */
const KR_STOCKISTS: string[] = [
  "worksout.co.kr",
  "hiver.co.kr",
  "casastore.co.kr",
  "afterpray.com",
  "unipair.com",
  "eqlstore.com",
  "wconcept.co.kr",
  "beakerstore.com",
  "aland.co.kr",
  "sivillage.com",
  "hago.kr",
  "4xr.co.kr",
];

/*
 * Japanese shops.
 *
 * The collectors need a public catalogue, which rules out the two
 * biggest names in Japanese fashion retail: ZOZOTOWN and Rakuten are
 * proprietary platforms with nothing to read, the same reason a custom
 * storefront like recto.shop cannot be collected. What is left is the
 * boutiques on Shopify, which the existing Shopify collector reads
 * without a line of new code — a shop pricing in yen now resolves to
 * the Japanese storefront through CURRENCY_MARKETS.
 */
const JP_STOCKISTS: string[] = [
  "cottonsupply.jp",
  "1ldk.jp",
  "vendorsupply.jp",
  "graphpaper-tokyo.com",
  "bshop-inc.com",
  "journal-standard.jp",
  "nubian.jp",
  "loftman.co.jp",
  "hinoya.jp",
  "camoshita.com",
  "studious.co.jp",
  "sonso.jp",
];

/*
 * One list, deduplicated. Order matters a little: candidates are probed
 * in batches and the run stops once enough stockists are confirmed, so
 * the shops most likely to carry a given label come first.
 */
export const KNOWN_STOCKISTS: string[] = Array.from(
  new Set([...US_STOCKISTS, ...KR_STOCKISTS, ...JP_STOCKISTS]),
);
