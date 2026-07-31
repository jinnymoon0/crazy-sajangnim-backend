# Crazy Sajangnim Backend

Product collection and catalog service for the Crazy Sajangnim shop. It
crawls retailer catalogs, verifies sale prices, writes them to Supabase,
and serves the catalog to the frontend.

The frontend (`crazy_sajangnim`) keeps everything a visitor touches —
pages, Google sign-in, the blog, and accounts. It never talks to the
product tables directly; it calls this service.

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /api/catalog/products` | Read the catalog (market, gender, page, size, sort, brand, category). Requires the service token. |
| `GET /api/products` | Run a collection pass and persist results. Requires the service token. `mode=direct` skips search-engine discovery. |
| `GET /api/cron/refresh-products` | Nightly refresh for one market/gender pair. Requires `CRON_SECRET`. |

Both product routes answer JSON and are meant to be called
server-to-server, not from a browser.

## API reference

An OpenAPI 3 description of every endpoint lives in
`src/openapi/spec.json` and is browsable as Swagger UI at
[/docs](http://localhost:3002/docs), with the raw document at
`/api/openapi`.

Because the reference describes an authenticated internal service, both
are available in development but hidden in production unless
`ENABLE_API_DOCS=true` is set — they answer 404 otherwise. To try a
request from the page, press **Authorize** and enter the value of
`BACKEND_API_TOKEN`.

Keep the spec in step with the routes when parameters or responses
change; nothing generates it automatically.

## Environment

Copy `.env.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — the same
  Supabase project the frontend uses
- `SEARXNG_URL` — search instance for discovery
- `BACKEND_API_TOKEN` — shared secret; the frontend sends it as
  `Authorization: Bearer <token>`. Leave unset locally to skip the check
- `CRON_SECRET` — protects the refresh endpoint

## Run

```bash
npm install
npm run dev
```

Serves on http://localhost:3002 (the frontend uses 3000, the admin 3001).

## Deploy

Deploy as its own Vercel project. Set the five variables above, and give
the frontend project a matching `BACKEND_URL` (this service's URL) and
`BACKEND_API_TOKEN`. `vercel.json` schedules the nightly refresh for each
market and gender.

## Layout

```
src/app/api/     catalog, collection, and cron routes
src/lib/products/  collectors, retailer adapters, catalog repository
src/lib/collectors/, src/lib/retailers/, src/lib/search/
src/constants/   brands and categories
scripts/         collector diagnostics
```
