# Crazy Sajangnim — architecture

A sale aggregator for Korean and American designer fashion. It reads
discounted stock from retailers, works out what brand and what kind of
garment each item is, and presents the result as two storefronts (US and
KR) with a small blog attached.

The interesting problem is not the shop. It is that no retailer agrees
with any other about what a product *is*, and the only reliable input is
a title someone typed into a CMS.

## The three services

| Repo | Runs at | Holds |
| --- | --- | --- |
| `crazy_sajangnim` | the public site | storefront, blog, accounts, visitor analytics |
| `crazy-sajangnim-backend` | an internal service | collection, inference, the catalog, brand discovery |
| `crazy-sajangnim-admin` | a private admin | brands, users, visits, analytics, messages |

They are separate deployments, not one app with three routes, for one
reason: **the collection runs are slow and the shop must not be.**
Collection walks dozens of retailer catalogues, several pages each, with
retries — a job measured in minutes. Sharing a deployment with the
storefront would mean sharing its function budget, its cold starts and
its incident surface. Keeping them apart means a collection run that
hangs cannot take the shop down with it.

The cost is real and worth stating: three deployments, three sets of
environment variables, and a service token to maintain between them.

## How a product arrives

```
retailer (Shopify / cafe24 / END / Musinsa / 29cm / HBX / Garmentory)
    │  JSON or HTML, one page at a time
    ▼
source adapter  (src/lib/products/sources/*)
    │  a common Product shape
    ▼
inferBrand      ← the retailer's own brand field first, the title only as a fallback
inferCategory   ← ordered keyword rules, first match wins
    │
    ▼
product_catalog (Supabase)
    │  read by the shop through a server-side proxy that holds the token
    ▼
storefront
```

Everything downstream of the adapters is deterministic and pure, which
is what makes it testable: `inferBrand` and `inferCategory` are ordinary
functions over a string, and the test suite runs them against titles
that really appeared in the catalog.

## Data

Supabase (Postgres), reached **only** through the service role from
server code. RLS is on and there are no anonymous policies, so a leaked
public key grants nothing. Every read and write goes through an API
route that has already decided who is asking.

Main tables:

- `product_catalog` — one row per product per storefront, with the brand
  and category inferred at collection time
- `brands` — what is tracked, with aliases and the brand's own shop
- `retailers` — shops the collectors read, discovered or seeded
- `site_users`, `blog_posts`, `blog_comments`, `blog_likes` — accounts
  and the blog
- `site_visits`, `site_page_views`, `site_events` — who arrived, what
  they opened, what they did
- `rate_limits` — request counts per caller per window

One constraint shapes a lot of this code: **PostgREST caps any response
at 1000 rows regardless of the limit asked for.** Reading a table and
counting the result silently undercounts everything past the cap, and
because rows come back oldest-first, the things that read as empty are
the ones added most recently. Anything that counts either asks the
database to count (`count: "exact", head: true`) or pages explicitly.

## Who may do what

Three separate mechanisms, because there are three kinds of caller.

**Visitors** — the shop is public. Opening a product, the blog, or
sharing to the blog requires an account (Google via Auth.js v5, JWT
sessions). A random id in a cookie identifies a browser for analytics;
it names nobody by itself.

**The shop and admin talking to the backend** — a shared bearer token
(`BACKEND_API_TOKEN`), compared in constant time. Absent that variable
the backend refuses everything when deployed rather than falling open.

**Admins** — a Google session whose email is in `admin_emails`. Removal
from the table locks the account out on its next request. One address is
the super admin, and may edit or delete anyone's posts and comments.

Authorship is always the **account id**, never the username. A username
is unique among accounts that exist, not across time.

## Failure, and why it is mostly quiet

Almost nothing here fails loudly. A collection run that finds nothing
looks exactly like a day with no sales; a search provider that has been
refusing since a key expired returns an empty list, which is what "no
shops stock this brand" also looks like. The nightly refresh once failed
for weeks and the only symptom was a catalog that stopped changing.

So the system is built to make silence detectable:

- `GET /api/health` (with a token) reports database reachability,
  catalog freshness, brand drift and per-provider search health
- `searchHealth()` distinguishes "found nothing" from "never could"
- `GET /api/brands/sync` reports products filed under untracked brands
- the shop records latency and failures per catalog read, surfaced in
  the admin's Analytics page

## Testing

`npm test` in the backend and the shop. Vitest, node environment, no
database — the suites cover the pure logic where the bugs actually were:
the brand matcher, the category rules, the search cascade's failure
behaviour, the service token, and the shop's authorship and moderation
rules.

The cases are real titles from the catalog, kept because each one was a
bug: `Easymoc Slip-On`, `Nylon Quilt Shirt Jacket`, `Nanamica Velveteen
Cap`.
