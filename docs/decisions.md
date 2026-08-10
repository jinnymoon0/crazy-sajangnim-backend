# Decisions

Why the system is the way it is. Each entry records what was decided,
what it cost, and — where one exists — the failure that prompted it.

Entries are append-only. A decision that turned out to be wrong gets a
superseding entry rather than an edit, because the reasoning that led to
it is the useful part.

---

## 1. Three deployments rather than one app

Collection runs take minutes; the storefront must answer in
milliseconds. Sharing a deployment would share the function budget and
the blast radius.

**Cost.** Three sets of environment variables, and a shared token to
maintain. A change spanning the shop and the backend is two deploys.

## 2. Supabase reached only by the service role

RLS is on with no anonymous policies. Every query runs server-side
behind a route that has already established who is asking.

**Why not RLS policies per table.** The access rules here are not really
per-row — they are "the collector may write anything", "a reader may
read the catalog", "an author may edit their own post". Expressing that
as policies means encoding the same logic twice, in SQL and in the
route, and the two drift.

**Cost.** No direct client access, so every read needs a route. A leaked
anon key grants nothing, which is the point.

## 3. The retailer's brand field beats the product title

`inferBrand(text, { fromBrandField })`. Names that are ordinary English
words — ON, OFF, NEW, SLIP — match **only** when the shop itself says a
product is that brand, never because the word appears in a title.

**The failure.** ON is a real brand. `Easymoc Slip-On`, `Vans Slip-On`
and `FOOT CAST///SLIP ON` were all filed under it, because the hyphen in
"Slip-On" counts as a word boundary and the matcher was checking for ON
as a whole word.

**The fix that was wrong.** Rejecting *short* aliases. That would have
silently stopped 니들스, CDG and ALD from ever matching — they are just
as short and are never anything but the brand. The rule is "is it an
ordinary word", not "is it short".

## 4. Category rules are an ordered list, first match wins

Narrow before broad: sweatshirts before t-shirts before shirts;
trousers before shoes so a bootcut jean is not footwear; shoes before
dresses so a dress shoe is not a dress.

**Cost.** Order is load-bearing and invisible. Reordering the list
silently reclassifies stock, which is why the overlapping pairs each
have a test naming the pair.

## 5. Keyword matching: word boundaries, but only where they help

Multi-word keywords and very short ones need a word boundary. Ordinary
ones stay a plain substring.

**The failure.** `"t shirt"` matched inside `"quilt shirt"`, `"placket
shirt"` and `"print shirt"` — 21 products filed as t-shirts. `"tee"`
matched inside `"sateen"` and `"velveteen"`, making a Needles jacket and
a Nanamica cap into t-shirts.

**The over-correction.** Requiring a boundary everywhere broke
`"sweatpant"`, `"knitted"` and `"knitwear"`, where the keyword is
legitimately part of a compound. Measured by running old and new over
all 3,468 distinct product names: the strict version moved 61 names,
17 of them wrongly. The narrowed rule moves 44, all correct.

## 6. Unplaceable products go to "etc", never to a guess

A guess parked in Accessories is worse than an honest shrug: it makes
that shelf untrustworthy for the things that do belong on it.

## 7. Counting is done by the database

`count: "exact", head: true` per brand, never `select(...).length`.

**The failure.** PostgREST caps responses at 1000 rows whatever limit is
asked for. A `.limit(20000)` read counted 1000, and since rows arrive
oldest-first, the brands that read as having no products were exactly
the ones added most recently. A failed count returns `null`, not `0` — a
brand whose count could not be read has not been shown to have nothing.

## 8. The search cascade has one budget, and remembers failure

A total deadline across all providers, a share of it handed to each, and
a provider that fails permanently (401/403/unreachable) is not asked
again this process.

**The failure.** Each provider had its own timeout and nothing bounded
the sum. A host that accepts a connection and then says nothing cost 22s
per query, three queries per brand. Separately, the Google project has
no access to the Custom Search API and returned 403 — which was retried
on every single query, forever. Measured: 66s to 20s for a brand with
every provider dead.

**Consequence.** A provider disabled by a since-fixed misconfiguration
stays disabled until the process restarts. Acceptable: these are
serverless functions with short lives, and `searchHealth()` says which
are off and why.

## 9. Service auth fails closed

No `BACKEND_API_TOKEN` means every request is refused when deployed.
Locally, with no token, the check is skipped.

**The failure it prevents.** The check used to be skipped whenever the
variable was absent — everywhere. A deployment that lost it through a
typo or a cleared variable served the catalog writes and brand deletion
to anyone who asked, and nothing looked wrong from outside.
Authentication that switches itself off when its configuration goes
missing is worse than none.

The comparison is constant-time; `===` returns as soon as two bytes
differ, so the time taken says where the first mistake was.

## 10. Deleting a brand deletes its products

Pass `?keepProducts=true` for a rename, where the rows are about to be
re-filed.

**The failure.** Products were left behind. The shop builds its brand
filters from the catalog, not the brands table, so those products went
on being offered under a brand that could no longer be looked up. This
is the other half of the ON bug: the matcher mis-attributed them, and
deletion orphaned them. `GET /api/brands/sync` reports drift already
there.

## 11. Authorship is the account id, never the username

**Why.** A username is unique among accounts that exist, not across
time. Deleting an account frees its name for anyone else to claim, and
reading the name as proof of authorship would hand that person
everything the first one ever wrote. Rows with no id are editable by
nobody.

Display names are resolved from the account as it stands now, so a
rename carries across everything the person has written.

## 12. Comment threads nest, up to six levels

Past that a reply joins the deepest ancestor still within the limit —
the conversation carries on, it just stops moving right.

**Superseded.** Replies were one level deep, with the API walking up to
the root before saving. That made "answering a reply" and "answering the
thread" the same act, which reads wrongly once a thread has more than
two people in it.

## 13. Rate limits are counted in the database

A Postgres function does the read and the increment in one statement.

**Why not in memory.** The site is serverless: consecutive requests land
on different instances, so a per-instance counter is a limit an attacker
leaves behind simply by being spread across them.

**Why one atomic statement.** Selecting the count and then updating it
lets two simultaneous requests both read the same number and both be
allowed — exactly the case a limiter exists for.

**Degradation.** If the table is missing the limiter counts in memory
and says so once. If it errors, the request is **allowed**. A rate
limiter whose own failure blocks writing is worse than the abuse it
prevents.

## 14. One events table with a kind and a jsonb payload

Rather than a table per event type.

**Why.** The shapes differ and will keep differing; four narrow tables
would mean a migration every time something new is worth counting, and
the query that matters most — "what happened around this visitor" — is a
single ordered read.

**Cost.** No column-level typing on the payload. Keys and value lengths
are trimmed on the way in so a caller cannot park a megabyte in it.

## 15. The browser may report only searches and clicks

Latency and failures are recorded server-side.

**Why.** A client can claim any duration it likes. An analytics table
that anyone can write arbitrary numbers into is not evidence of
anything, and latency is exactly the number someone would want to
falsify.

## 16. No Content-Security-Policy yet

Next injects inline bootstrap scripts. A policy strict enough to be
worth having needs per-request nonces threaded through the layout; one
loose enough to avoid that (`unsafe-inline`) offers reassurance rather
than protection.

Recorded so the omission reads as a decision. The other headers —
`nosniff`, `X-Frame-Options: DENY`, HSTS, `Permissions-Policy` — are
set, and `nosniff` in particular matters because blog images are
uploaded by anyone with an account.

## 17. An account is asked for at the point of taking part

Browsing sale items and reading the blog's front page need no account.
Opening a product's retailer link, opening a blog post, writing one,
commenting, and sharing a find to the blog all do.

**Why.** The catalog and the feed are the reasons to visit, and gating
them costs visitors before they have any reason to trust the site.
Everything that writes, that sends someone to a retailer, or that puts a
name against words is worth an account.

**Superseded.** The whole blog used to need one, including reading the
list of posts — so a shared link led to a login page rather than to the
thing that was shared.

**Where it is enforced.** `src/proxy.ts` gates `/blog/:path+` rather
than `/blog/:path*`: the star form matches zero segments, so it would
take `/blog` itself with it. The `/api/blog` routes stay gated and
answer 401 rather than redirecting, because a 307 preserves the method
and a POST would follow it to the login page, get a 200, and look as
though it had been written.

## 18. Visitors are a random id in a cookie

It names nobody by itself; it only lets a second visit from the same
browser be recognised as the same one. When someone signs in, their
earlier rows are backfilled with the account id, so the history before
the account joins up with it.

## 19. Textura Libera for the wordmark

**Why it was not simply "a blackletter font".** The first attempt used
Fraktur, where the capital S is drawn with a bowl that reads as a G —
"Crazy Gajangnim". Textura draws the S open. The distinction is between
two blackletter traditions, not between two files.

## 20. The nightly refresh is scheduled by GitHub Actions, not Vercel

`.github/workflows/refresh-catalog.yml` calls the same
`/api/cron/refresh-products` endpoint for each of the four storefronts,
one at a time.

**The failure.** Four Vercel cron jobs were declared at 16:00–19:00 UTC
and never fired — the project is on the Hobby plan, which does not run
four hour-precise schedules. Nothing reported this. Every collection
timestamp in the database sat outside the scheduled window: Jul 29,
Jul 31, Aug 3, Aug 5, all at times matching manual runs. The catalog had
gone 28 hours stale before the health check surfaced it, and a stale
catalog looks exactly like a quiet week for sales.

**Why not simply fewer Vercel crons.** Collapsing four into one would
put the whole refresh in a single invocation, and the four together take
about five minutes against a 300-second ceiling.

**What it costs.** Scheduled runs on GitHub can be delayed when the
service is busy. That is acceptable for a nightly job and is the trade
for not paying for a scheduler.

**Why the step checks the body, not just the status.** The route reports
the outcome of the collection inside a 200: an upstream that refused
still comes back well-formed. `ok` and `count` are what say whether
anything was actually collected.

The Vercel `crons` block is left in `vercel.json` so nothing is lost if
the project moves to a plan that runs it — but if that happens, one of
the two schedules should be removed rather than refreshing twice.

## 21. Health fails when a storefront has nothing to sell

`checkStorefronts()` counts live products per market and gender. Any
storefront at zero makes the whole service report `down`, not
`degraded`, and answer 503.

**The failure.** On 9 August a statement run outside the application
marked all 4,692 catalog rows unavailable. Every check in place passed
while it happened — the database answered, the catalog had been
collected hours earlier, the brands were tracked — and health reported
`degraded` for unrelated brand drift. The shop served an empty page for
a day, and the thing that noticed was a person opening the site.

Nothing was watching the one number a shop exists to produce.

**Why an outage rather than a degradation.** To whoever opens the site,
an empty catalog and a dead server are the same event.

**Why an unauthenticated caller now gets a truthful status code.** It
still learns nothing else — the body is `{"status":"down"}` and no
detail — but the code lets any free uptime service watch the shop
without a token. The monitoring that failed here was ours; a check that
depends on our own scheduler shares its failure modes, and this one
deliberately does not.

**What still is not protected.** Anything holding the service-role key
can mark the catalog unavailable again. Nothing in the application
writes `is_available = false` — the column defaults to true and every
source sets it true — so if it happens again it came from outside, and
the answer is to find what has that key rather than to add a guard the
same key could remove.

