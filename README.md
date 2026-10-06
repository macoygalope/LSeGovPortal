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

Node 22.13 or newer.

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

## Local database (SQLite)

A SQLite copy of the sheet, so a build doesn't need the Apps Script backend.
It uses Node's built-in `node:sqlite`; there is nothing extra to install.

```sh
npm run db:import -- --file fixtures/live-all.json   # or --live, to pull from the backend
EGOV_DB_FILE=data/egov.db npm run build:kiosk        # build from it
```

A build from the database is byte-for-byte the same site as one from the
backend, because the database is read back out as the same `action=all`
payload and goes through the same normalising. Like `EGOV_DATA_FILE`, set
`EGOV_DB_FILE` in the shell for a build. A build fails, rather than publishing
an empty site, if that file is missing or isn't an eGov database.

| Command | Does |
|---|---|
| `npm run db:import -- --file <json>` or `--live` | Loads a saved response, or the live backend. Refuses a database that already has content unless you add `--replace`. |
| `npm run db:export -- --out backup.json` | Dumps the database in the same format, drafts included. |
| `npm run db:migrate` | Brings an older database file up to the current schema. |

`--db <path>` picks another file; the default is `$EGOV_DB_FILE`, then `data/egov.db`.

**Tables** (`src/lib/db-schema.ts`):

- `records`: every section's documents, keyed by `(section, id)`. The pin,
  memorandum and publication-number columns sit here too, because the sheet
  fills them on every tab.
- `settings`: the site settings, one row per key.
- `numbering`: the last sequence handed out per numbered section (executive
  orders, memorandums, resolutions) and year.
- Views `forms`, `announcements`, `executive_orders`, `memorandums` and
  `resolutions`: one read-only view per section with just its own columns, for
  browsing in any SQLite tool.

**Things to know**

- **It is a copy, not the source of truth.** The Google Sheet is still the CMS
  and the admin dashboard still writes to it. Importing with `--replace`
  overwrites whatever is in the database, and `--live` only brings published
  records, because that is all the backend returns.
- **The database is stricter than the sheet.** Dates must be `YYYY-MM-DD`, a
  form needs its link, and two documents can't share a stored number. A bad
  row stops the whole import and the error names it.
- **Numbering is worked out at import.** The backend doesn't return its
  Numbering tab, so each counter starts at the highest number among the
  imported documents (stored year and sequence, else the printed
  "Blg. 07, Serye ng 2026"). If the real counter is ahead of that, because it
  already handed out numbers to documents since deleted, raise `last_sequence`
  in `numbering`. `allocateSequence()` hands out the next number; nothing in
  the admin uses it yet.
- **Changing the schema:** append a migration to `MIGRATIONS` in
  `src/lib/db-schema.ts`. Never edit one that has been applied.

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
  lib/db.ts, db-schema.ts  the local SQLite copy of the sheet and its migrations
  lib/i18n.ts, messages/   localization: helpers and the Filipino / English catalogs
  scripts/                 small client scripts: form pop-out, archive search/sort, language switching
  styles/global.css
scripts/build.mjs          build wrapper (staging folder, swapped into dist/ on success)
scripts/db.mjs             db:import / db:export / db:migrate
data/egov.db               the local database; created by db:import, not committed
google-apps-script/Code.gs the sheet backend (see the warning below)
fixtures/live-all.json     a saved backend response, used by the tests
legacy/                    the previous static site, kept for reference
```

## Languages

The interface is available in Filipino (Tagalog, the default) and English. A
dropdown in the footer of every page, including the admin dashboard, switches
between them, and the choice is remembered in the browser.

- **What is translated:** buttons, headings, labels, dates, placeholders, error
  messages and the admin dashboard. **What is not:** content typed into the
  Google Sheet (titles, descriptions, document bodies, names) is shown as
  written in both languages. The site settings that ship with default wording
  (subtitle, hero text, meeting button, footer text) are translated only while
  they still hold that default; once edited in the dashboard they are shown
  as written.
- **How it works:** pages are still built entirely in Filipino, so there is one
  build, one set of URLs and the kiosk hosting is unaffected. Translatable
  elements carry `data-i18n*` attributes and `src/scripts/i18n.ts` swaps the
  text in the browser. Nothing is fetched at runtime.
- **Changing or adding text:** edit `src/lib/messages/fil.ts` and
  `src/lib/messages/en.ts`. `en.ts` is typed from `fil.ts`, so `astro check`
  fails if a key is missing, and `npm test` checks that both languages use the
  same `{placeholders}`. In a page, write
  `<h2 {...i18n("some.key")}>{t("some.key")}</h2>`; for attributes use
  `i18nAttr({ placeholder: "some.key" })`.
- **Adding a language:** add it to `LANGS` and `LANG_NAMES` in
  `src/lib/i18n.ts`, create its catalog, and register it in `MESSAGES`.
- **Backend errors:** the dashboard shows errors from `Code.gs`, which are
  Filipino sentences. The `admin.be.*` messages must match them exactly, so
  if you reword an error in `Code.gs`, reword it in `fil.ts` too.
- **Kiosk:** the kiosk browser may not keep `localStorage`, in which case it
  simply opens in Filipino each time.

## Tests

```sh
npm test         # unit tests: normalising, sorting, numbering, pins, markdown, database
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
