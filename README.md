# Buyer Search Tool

Single-page B2B buyer discovery app backed by the local Google Maps scraper in
`../external-tools/google-maps-scraper-kit`. Enter a natural-language search such as
`plastic manufacturer list in Nepal`; the app sends that query to the scraper without
requiring separate country or buyer-type selections. Filter results client-side, and
export CSV or copy a TSV table.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The app starts the scraper engine automatically with
`python3 scripts/engine.py start` if it is not already running. To point the app at a
different engine or scraper checkout, set:

```bash
SCRAPER_ENGINE_URL=http://127.0.0.1:8080
SCRAPER_DIR=/absolute/path/to/google-maps-scraper-kit
SCRAPER_PYTHON=python3
# SCRAPER_API_KEY=optional-engine-api-key
```

See `.env.example`.

The search API is local to the Next.js app:

- `POST /api/search` validates a search query and starts a Google Maps scraper job.
- `GET /api/search/:searchId` returns status, progress, and results as they arrive.
- `POST /api/search/:searchId/cancel` stops a running job.

Search jobs and result snapshots are held in app memory; they are not searchable after
the app process restarts. The existing scraper engine stores its own job files in its
local `.engine` directory. Only one app-started search runs at a time, and identical
retries while a job is starting or running return the existing search rather than
launching a duplicate.

## Scripts

```bash
npm run dev    # development server
npm run build  # production build + type check
npm run start  # serve the production build
npm run lint   # eslint
```
