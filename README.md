# Los Santos eGov

The Los Santos city-government portal: online forms, announcements, executive
orders, resolutions and memorandums. Built with [Astro](https://astro.build) as
a static site. Content is managed in a Google Sheet through an Apps Script
backend and **baked into the pages at build time**, so the site makes no data
requests when it loads.

It has two build targets:

| Command | Served from | Contains |
|---|---|---|
| `npm run build:kiosk` | `lspd-backend` at `/api/v1/websites/egov`, on in-game kiosk screens | The public site only |
| `npm run build` | A domain root (e.g. GitHub Pages) | The public site plus `/admin` |

The kiosk build has **no admin page, no outbound links and no print buttons**.
Links to Google Forms, the booking calendar and signed copies become disabled
"coming soon" placeholders until built-in forms exist, and links inside
document bodies render as plain text. See `src/lib/kiosk.ts`.

## Setup

```sh
npm install
cp .env.example .env      # set PUBLIC_EGOV_API_URL to the Apps Script /exec URL
npm run dev               # live data, http://localhost:4321
```

Node 22.12 or newer.

## Building and deploying to a kiosk

```sh
npm run build:kiosk
```

Then copy the contents of `dist/` into `lspd-backend/websites/egov/`.

The first time only, register the site so kiosks can pick it from the
`/spawnprop` Website dropdown:

```
POST /api/v1/internal/websites
X-Internal-Api-Key: <INTERNAL_API_KEY>
{"slug": "egov", "name": "Los Santos eGov", "type": "static"}
```

**Content only changes when you rebuild.** After publishing something in the
admin, run `npm run build:kiosk` and copy `dist/` again. A scheduled rebuild is
also needed for pinned announcements that have an expiry date, because the pin
is evaluated at build time.

A build fails if the backend can't be reached. The wrapper in
`scripts/build.mjs` builds into `.build/` and only swaps it into `dist/` on
success, so a failed build never leaves you with a half-written `dist/` to
copy.

To build from a saved response instead of the live backend:

```sh
EGOV_DATA_FILE=fixtures/live-all.json npm run build:kiosk
```

## Layout

```
src/
  pages/
    index.astro            home
    [section]/index.astro  archive: search, sort, pagination
    [section]/[id].astro   one page per document (memorandums get the formal layout)
  admin/                   dashboard, non-kiosk build only (admin.js is still plain JS)
  components/              Layout, DocumentCard, FormViewer, ExternalAction, ...
  lib/                     data loading, normalising, sorting, markdown, image handling
  scripts/                 small client scripts: form pop-out, archive search/sort
  styles/global.css
google-apps-script/Code.gs the sheet backend (see the warning below)
fixtures/live-all.json     a saved backend response, used by the tests
legacy/                    the previous static site, kept for reference
```

## Tests

```sh
npm test         # unit tests: normalising, sorting, numbering, pins, markdown
npm run check    # type-check
```

## Things to know

- **`google-apps-script/Code.gs` is out of date.** The deployed backend returns
  fields this copy doesn't know about (pinned announcements, auto-numbering,
  memorandum fields, `uploadStatus`). The site is built against the *deployed*
  backend. Don't redeploy from this copy without updating it first.
- **Images are downloaded at build time** from the host in `image.domains`
  (`astro.config.mjs`), resized and converted to WebP. Add a new image host there.
- **Archive search covers full document text**, which is embedded in each card.
  That is fine at a few dozen documents; move to a separate search index if the
  archive grows into the hundreds.
- **Archive pages need JavaScript** to show anything past page 1.
- `dist/404.html` is built but `lspd-backend` doesn't serve it; unknown paths
  get its JSON 404.
