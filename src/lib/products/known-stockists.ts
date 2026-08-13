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

  /*
   * Probed before listing, and two of them earn their place today:
   * No Man Walks Alone had eleven Beams Plus items reduced and Machus
   * three from C.P. Company. The rest are readable and discount
   * heavily, but stock labels we do not track yet — they cost one
   * request each and start paying the moment the brand list grows.
   */
  "nomanwalksalone.com",
  "machusonline.com",
  "divisionroadinc.com",
  "standardandstrange.com",
  "lockwoodshop.com",
  "blueingreensoho.com",
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

  /* Cafe24 shops, probed: readable and pricing in won. */
  "vivastudio.co.kr",
  "emis.kr",
  "matinkim.com",
  "kirsh.co.kr",
  "covernat.net",
];

/*
 * Japanese shops.
 *
 * Every one of these was probed before being listed: readable
 * catalogue, and pricing in yen. That check mattered more here than
 * anywhere else — of thirty-eight Japanese shops tried on reputation,
 * two were readable. Shopify is not what Japanese retail runs on.
 *
 * What the rest run on is worth writing down, because it is the reason
 * this list is short rather than an oversight. The multi-brand curation
 * shops — 1LDK, GR8, Nubian, BEAMS, UNITED ARROWS, ESTNATION, Loftman —
 * are on Magento or a proprietary Japanese platform, and several refuse
 * a request from outside Japan outright. None publishes a catalogue
 * this collector can read, and none can be added by listing a domain;
 * each would need its own reader.
 *
 * So this is mostly brands' own shops rather than curation shops.
 * UNDEFEATED's Japanese store is the exception that carries other
 * labels, which is why it is first.
 */
const JP_STOCKISTS: string[] = [
  "undefeated.jp",
  "graphpaper-tokyo.com",
  "wtaps.com",
  "neighborhood.jp",
  "markaware.jp",
  "kolor.jp",
  "hyke.jp",
  "taigatakahashi.com",

  /*
   * Probed: readable and pricing in yen. White Mountaineering had
   * twenty-eight items reduced when checked; the other three were at
   * full price but are the labels Western stockists discount hardest,
   * so they earn their place through those shops as much as their own.
   */
  "whitemountaineering.com",
  "sacai.jp",
  "isseymiyake.com",
  "ssstein.com",

  /*
   * The independent Japanese labels, which is where Shopify actually
   * took hold — the established names are on Magento or their own
   * platform. Three of these were discounting hard when probed: KEBOZ
   * a hundred and eighty-five items, beautiful people eighty,
   * 08sircus forty-seven.
   *
   * Nepenthes and Freak's Store are not here and cannot be. Every
   * domain form of both was tried: nepenthes.co.jp and its variants
   * serve no catalogue, and freaksstore.com is Magento with prices
   * rendered client-side. Neither can be reached by listing a domain.
   */
  "keboz.jp",
  "08sircus.com",
  "beautiful-people.jp",
  "freshservice.jp",
  "shinyakozuka.com",
  "irenisa.com",
  "mamekurogouchi.com",
  "refomed.jp",
  "unlikely.jp",
  "ancellm.com",
];

/*
 * One list, deduplicated. Order matters a little: candidates are probed
 * in batches and the run stops once enough stockists are confirmed, so
 * the shops most likely to carry a given label come first.
 */
export const KNOWN_STOCKISTS: string[] = Array.from(
  new Set([...US_STOCKISTS, ...KR_STOCKISTS, ...JP_STOCKISTS]),
);
