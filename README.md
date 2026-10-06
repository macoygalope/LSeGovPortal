# Los Santos eGov

The Los Santos city-government portal: online forms, announcements, executive
orders, resolutions and memorandums. Built with [Astro](https://astro.build) as
a static site. Content lives in a local SQLite database and is **baked into the
pages at build time**, so the site makes no data requests when it loads.

It has two build targets:

| Command | Served from | Contains |
|---|---|---|
| `npm run build:kiosk` | `lspd-backend` at `/api/v1/websites/egov`, on in-game kiosk screens | The kiosk site |
| `npm run build` | A domain root (e.g. GitHub Pages) | The regular site |

The kiosk build has **no outbound links and no print buttons**.
Links to Google Forms, the booking calendar and signed copies become disabled
"coming soon" placeholders until built-in forms exist, and links inside
document bodies render as plain text. See `src/lib/kiosk.ts`.

## Setup

```sh
npm install
npm run db:import -- --file fixtures/live-all.json   # creates data/egov.db
npm run dev                                          # http://localhost:4321
```

There is no backend to configure: a build and `npm run dev` read
`data/egov.db`. `.env.example` lists the optional `EGOV_*` overrides.

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

**Content only changes when you rebuild.** After changing the database, run
`npm run build:kiosk` and copy `dist/` again. A scheduled rebuild is also needed for pinned announcements that have an expiry date, because the pin
is evaluated at build time.

A build fails if the database is missing. The wrapper in
`scripts/build.mjs` builds into `.build/` and only swaps it into `dist/` on
success, so a failed build never leaves you with a half-written `dist/` to
copy.

To build from a saved response instead of the database:

```sh
EGOV_DATA_FILE=fixtures/live-all.json npm run build:kiosk
```

### Citizen ID (fingerprint scan)

On the kiosk build, each form's pop-out has a hold-to-scan fingerprint step.
It works the same way as in `prestige-lspd-website`: `prestige-hardware`
opens the kiosk with `?citizenId=` on the URL, the site keeps it in
`sessionStorage` (so it survives clicking through to other pages), and holding
the scan button looks the citizen up at
`GET {PUBLIC_LSPD_API_URL}/api/v1/public/citizens/:citizenId` and shows their
identity card. The id is taken as given, not re-verified.

Set `PUBLIC_LSPD_API_URL` to `lspd-backend`'s origin **before**
`npm run build:kiosk` (see `.env.example`): it is baked into the build. Without
it, or when the site is opened outside the game, the scan reports an error.
The code is in `src/lib/citizen.ts` and `src/scripts/citizen-scan.ts`.

## Local database (SQLite)

The site's content lives in a SQLite file, `data/egov.db` (not committed). It
uses Node's built-in `node:sqlite`; there is nothing extra to install.

```sh
npm run db:import -- --file fixtures/live-all.json   # create it from a saved response
npm run build:kiosk                                  # build from it
```

The database is read back out as an `action=all` payload (the format of
`fixtures/live-all.json`) and goes through the same normalising as a saved
response, so the two give the same site. `EGOV_DB_FILE` picks another path and
`EGOV_DATA_FILE` skips the database for a saved response. A build fails, rather
than publishing an empty site, if the database is missing or isn't an eGov
database.

| Command | Does |
|---|---|
| `npm run db:import -- --file <json>` | Loads a saved response. Refuses a database that already has content unless you add `--replace`. |
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
- `site_admins`: `citizenid`, `name`, `created_at`. The citizens allowed to sign
  in to the admin dashboard. It isn't part of the sheet, so `db:import` and
  `db:export` leave it alone: back it up with the database file.
- Views `forms`, `announcements`, `executive_orders`, `memorandums` and
  `resolutions`: one read-only view per section with just its own columns, for
  browsing in any SQLite tool.

**Things to know**

- **The database is the source of truth.** Edit it in the admin dashboard
  (`npm run admin`, below), or load a saved response with `db:import`. There is
  no Google Sheet connection any more. Importing with `--replace` overwrites
  whatever is in the database, so `db:export` a backup first.
- **The database is stricter than the sheet.** Dates must be `YYYY-MM-DD`, a
  form needs its link, and two documents can't share a stored number. A bad
  row stops the whole import and the error names it.
- **Numbering is worked out at import.** A saved response doesn't carry the
  sheet's Numbering tab, so each counter starts at the highest number among the
  imported documents (stored year and sequence, else the printed
  "Blg. 07, Serye ng 2026"). If the real counter is ahead of that, because it
  already handed out numbers to documents since deleted, raise `last_sequence`
  in `numbering`. `allocateSequence()` hands out the next number; the
  dashboard calls it the first time an automatically numbered document is
  published.
- **Announcements can be edited in the database.** `src/lib/announcements.ts`
  has `createAnnouncement`, `getAnnouncement`, `listAnnouncements`,
  `updateAnnouncement` and `deleteAnnouncement`, each taking the open database
  first. They write to `records` (the `announcements` view is read-only) and
  refuse what `Code.gs` refused: no title, no content or link, content over
  45,000 characters. The edits live only in this file, so the next
  `db:import --replace` overwrites them. It covers announcements only: the
  dashboard uses `src/lib/records.ts`, which does the same for every section.
- **Changing the schema:** append a migration to `MIGRATIONS` in
  `src/lib/db-schema.ts`. Never edit one that has been applied.

## Admin dashboard

```sh
npm run admins -- add ABC12345 "Your Name"   # once: put yourself on the list
npm run admin                                # http://127.0.0.1:4322/admin
```

Adds, edits, publishes and deletes forms, announcements, executive orders,
memorandums and resolutions, and edits the site settings (images, hero text,
default signatory). It is the old dashboard, in Filipino and English, saving to
`data/egov.db` instead of the Google Sheet.

It is an Astro dev server that also serves the `/admin` page and the API behind
it (`src/lib/admin-api.ts`). Because it writes to the database it exists only
in this command: the page is in neither build, and `astro.config.mjs` doesn't
know about it. The same process serves the site, so its pages show a saved
change on the next reload.

- **Signing in is by citizen ID.** Only citizens in the `site_admins` table get
  in (ID matched without regard to capitals). Inside the game the kiosk puts the
  ID on the URL (`?citizenId=`) and the dashboard checks it without asking;
  anywhere else, type it in, or open `/admin?citizenId=ABC12345`. A sign-in
  lasts 12 hours or until the server stops, and is checked against the list on
  every request, so removing someone signs them out at once. Their name shows at
  the top of the page, and sign-ins and refusals are printed in the terminal.
- **Managing the list** is done from the command line, so the first admin doesn't
  have to be let in by someone who isn't one yet: `npm run admins -- list`,
  `-- add <citizenId> "<name>"`, `-- remove <citizenId>`. An empty list means
  nobody can sign in; `npm run admin` says so at startup.
- **A citizen ID is not a password.** It proves nothing by itself: the ID comes
  from the URL, and it is printed on the identity card the kiosk shows. Anyone
  who can reach the server and knows an admin's ID can sign in as them. That is
  acceptable for the default, which listens on this machine only. Failed
  sign-ins are rate limited (5 a minute per address), but don't expose it more
  widely without something that is a secret: a second factor, or an ID the game
  signs.
- **Trying it without the game.** In development, `PUBLIC_MOCK_CITIZEN_ID` in
  `.env` (see `.env.example`) is the citizen the dashboard assumes when the
  browser has none: put them on the list with `npm run admins -- add ...` and
  `/admin` signs them in on load. An ID on the URL, or one already kept for the
  tab, wins, and signing out turns the mock off for that tab. No build contains
  it (`import.meta.env.DEV` is false in a build, which removes it), and it lets
  nobody in unless that citizen is on the list. Leave it unset anywhere real
  people use the dashboard.
- **Local only by default.** `--host` opens it to other machines over plain
  HTTP, which makes the point above real. `--port` and `--db <file>` pick
  another port or database. The database has to exist already (`db:import`, or
  `db:migrate` for an empty one); running the dashboard brings an older one up
  to the current schema, and a build then wants that schema too.
- **Saving is not publishing.** A change reaches the kiosk only after
  `npm run build:kiosk` and copying `dist/`. Drafts never reach a build.
- **Numbering.** An executive order, memorandum or resolution is numbered the
  first time it is published, in the year of its date: "Executive Order Blg. 07,
  Serye ng 2026", "Memorandum Blg. 2026-12", "Resolusyon Blg. 02, Serye ng
  2026". Deleting one never frees its number. A number typed by hand is kept
  and moves the counter past it. The memorandum and resolution wording is what
  the live documents use; no live executive order was numbered automatically, so
  that wording is a guess: change `formatNumber()` in `src/lib/records.ts` if it
  should read like the manual ones ("KAUTUSANG TAGAPAGPAGANAP BLG.: 07 Serye ng
  2026").
- **The rules** are the old backend's (a title, a form's link, content or a
  link, at most 45,000 characters, a pin order of 1 to 3) plus: links must be
  `http(s)`, dates must exist, numbered documents need a date, and a memorandum
  needs a subject, a recipient and a sender. A live record that breaks them, such
  as the welcome announcement with no content or link, has to be fixed before it
  can be saved again.

## Layout

```
src/
  pages/
    index.astro            home
    [section]/index.astro  archive: search, sort, pagination
    [section]/[id].astro   one page per document (memorandums get the formal layout)
  components/              Layout, DocumentCard, FormViewer, ExternalAction, ...
  lib/                     data loading, normalising, sorting, markdown, image handling
  lib/db.ts, db-schema.ts  the local SQLite database and its migrations
  lib/records.ts           create / read / update / delete a section's records, numbering included
  lib/settings.ts          read / save the site settings
  lib/announcements.ts     the same for announcements only (the dashboard uses records.ts)
  lib/admin-api.ts         the dashboard's JSON API; admin-integration.ts adds it to the dev server
  lib/admins.ts            the site_admins whitelist; admin-auth.ts holds sessions and the sign-in limiter
  admin/                   the dashboard page and its script, served only by npm run admin
  lib/i18n.ts, messages/   localization: helpers and the Filipino / English catalogs
  scripts/                 small client scripts: form pop-out, archive search/sort, language switching
  styles/global.css
scripts/build.mjs          build wrapper (staging folder, swapped into dist/ on success)
scripts/db.mjs             db:import / db:export / db:migrate
scripts/admin.mjs          npm run admin
scripts/admins.mjs         npm run admins: list / add / remove who may sign in
data/egov.db               the local database; created by db:import, not committed
google-apps-script/Code.gs the old sheet backend; the site no longer uses it
fixtures/live-all.json     a saved backend response: seeds the database, used by the tests
legacy/                    the previous static site, kept for reference
```

## Languages

The interface is available in Filipino (Tagalog, the default) and English. A
dropdown in the footer of every page switches between them, and the choice is remembered in the browser.

- **What is translated:** buttons, headings, labels, dates, placeholders and
  error messages. **What is not:** content stored in the database (titles,
  descriptions, document bodies, names) is shown as written in both languages.
  The site settings that ship with default wording (subtitle, hero text,
  meeting button, footer text) are translated only while they still hold that
  default; once changed in the database they are shown as written.
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
- **Kiosk:** the kiosk browser may not keep `localStorage`, in which case it
  simply opens in Filipino each time.

## Tests

```sh
npm test         # unit tests: normalising, sorting, numbering, pins, markdown, database
npm run check    # type-check
```

## Things to know

- **The Google Sheet backend is retired.** The site no longer reads from it or
  writes to it, and the `/admin` dashboard that called it is replaced by
  `npm run admin`. `google-apps-script/Code.gs`
  is kept for reference only, and it is out of date: the deployed backend
  returns fields this copy doesn't know about (pinned announcements,
  auto-numbering, memorandum fields, `uploadStatus`). Don't redeploy from it.
- **Images are downloaded at build time** from the host in `image.domains`
  (`astro.config.mjs`), resized and converted to WebP. Add a new image host there.
- **Archive search covers full document text**, which is embedded in each card.
  That is fine at a few dozen documents; move to a separate search index if the
  archive grows into the hundreds.
- **Archive pages need JavaScript** to show anything past page 1.
- `dist/404.html` is built but `lspd-backend` doesn't serve it; unknown paths
  get its JSON 404.
