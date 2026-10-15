# Los Santos eGov

The Los Santos city-government portal: online forms, announcements, executive
orders, resolutions and memorandums. Built with [Astro](https://astro.build).

**The pages are a frame; the content arrives when a page opens.** Astro builds the
header, the footer, the headings and the page's scripts. The forms, the documents and
the settings (title, hero, mayor, footer) are fetched by the page itself, from
lspd-backend's database for the site, and put in by `src/scripts/egov-page.ts`
(markup from `src/lib/render.ts`). A record published in the in-game eGov app is
on the next kiosk screen that opens a page, with no rebuild and no deploy.

```
page opens -> GET <site>/db/site_records + <site>/db/site_settings   (live, from lspd-backend)
              if that fails -> /assets/snapshot.json                (the copy this build was made with)
              if that fails -> an error, and a retry button
```

It has two build targets:

| Command | Served from | Contains |
|---|---|---|
| `npm run build:kiosk` | `lspd-backend` at `/api/v1/websites/egov`, on in-game kiosk screens | The kiosk site |
| `npm run build` | A domain root (e.g. GitHub Pages) | The regular site |

The kiosk build asks the host it came from (same origin: no CORS, no address baked
in, the one bundle works on staging and production). A build served from anywhere
else sets `PUBLIC_EGOV_DATA_URL` to lspd-backend's site (see `.env.example`), or
leaves it unset and shows only the copy it was made with.

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

There is no backend to configure for development: `npm run dev` shows the copy
described below, read from `data/egov.db` on every page load, so a change made in
the admin dashboard (`npm run admin`) shows on reload. `.env.example` lists the
optional overrides.

Node 22.13 or newer.

### Trying it against a real lspd-backend

Run lspd-backend with its eGov database (a copy of `data/egov.db` as
`data/sites/egov/site.db` is enough; it is brought up to date when the server starts),
put the kiosk build in its `websites/egov/` folder and open
`http://localhost:8080/api/v1/websites/egov/`. Staff publishing in the in-game app,
or through its admin API, shows up on the next load.

## Building and deploying to a kiosk

```sh
npm run build:kiosk
```

That builds the site into `dist/`. You do not copy it to a server by hand: the pages,
the public copy of the database (see [Building the copy for a server](#building-the-copy-for-a-server))
and a small `site.json` that names the site travel together as one **bundle**, a `.zip`.

```sh
npm run site:pack          # build both, write bundles/egov-<date>-<time>.zip, print its SHA-256
npm run deploy -- staging  # build, upload over SSH and deploy it (see "Deploying to a server" below)
```

**A rebuild is for the frame, not the content.** The content is read live (see the
top of this file), so publishing, editing or taking down a record needs no build, and
a pinned announcement stops being pinned on its expiry date by itself (the page
decides when it opens). Rebuild and deploy only when the pages themselves change: a
layout, a script, the wording in `src/lib/messages/`. Deploy it with `--only content`
once lspd-backend's database is the live one: a bundle that carries a database is
refused for a site whose `site.db.live` marker is there (see below).

**The copy.** Every build also writes `assets/snapshot.json`, the published content as
it was when the build was made, for a page to show if lspd-backend does not answer.
It is made from the database a build always read (`EGOV_DB_FILE`, default
`data/egov.db`; a copy of lspd-backend's `site.db` will do) or `EGOV_DATA_FILE`. A
build that was told where the content is and cannot read it fails. One that was told
nothing and finds no `data/egov.db` goes on without a copy and says so; a page of
that build shows nothing if lspd-backend is down.

### Deploying to a server

Two ways, both ending in prestige-nginx's `deploy-site.ps1` on the server, which unpacks
the bundle, checks everything and deploys it (see `deploy/windows/README.md` there for
the server's side, including the one-time SSH setup):

- **One command, over SSH.** Put the `DEPLOY_*` settings from `.env.example` in `.env`
  (the server, the folder holding the deploy scripts, a drop folder), then:

  ```sh
  npm run deploy -- check staging       # test the login, an upload and the server, step by step
  npm run deploy -- staging             # build, upload, deploy
  npm run deploy -- staging --dry-run   # upload, and have the server check it without changing anything
  npm run deploy -- staging --only data # just the database (no rebuild)
  npm run deploy -- production          # asks you to type "production" (or pass --yes)
  npm run deploy -- production --zip bundles/egov-20261013-153000.zip   # the bundle staging already got
  ```

- **By hand, no SSH.** `npm run site:pack` makes the bundle and prints its SHA-256. Send that
  one file to whoever runs the server; they drag it onto `deploy-site-staging.cmd` or
  `deploy-site-production.cmd` in the server's `prestige-nginx\deploy\windows` folder.

The first time only, add `--register` (`npm run deploy -- staging --register`, or
`npm run site:pack -- --register`) so the server also registers the site, which is what lets kiosks
pick it from the `/spawnprop` Website dropdown. (By hand that is
`POST /api/v1/internal/websites` with `X-Internal-Api-Key` and
`{"slug": "egov", "name": "Los Santos eGov", "type": "dynamic"}`.)

Every bundle has `site.json` plus `content/` (this build) and/or `site.db` (the public
copy); `--only data` or `--only content` packs just one. The format and every check the
server makes are written down in `src/lib/site-bundle.ts`; the same checks run here
first, so a mistake (a database file in the build, the wrong database) is caught before
anything is sent. `bundles/` is not committed.

A build that was told where the content is (`EGOV_DB_FILE`, `EGOV_DATA_FILE`) and
cannot read it fails. The wrapper in `scripts/build.mjs` builds into `.build/` and
only swaps it into `dist/` on success, so a failed build never leaves you with a
half-written `dist/` to copy.

To build the copy from a saved response instead of the database, or from a copy of
lspd-backend's own database (which is ahead of this checkout's schema; reading it is
fine, writing to it from here is not):

```sh
EGOV_DATA_FILE=fixtures/live-all.json npm run build:kiosk
EGOV_DB_FILE=D:/backup/site.db npm run build:kiosk
```

### Citizen ID (fingerprint scan)

On the kiosk build, each form's pop-out has a hold-to-scan fingerprint step.
It works the same way as in `prestige-lspd-website`: `prestige-hardware`
opens the kiosk with `?citizenId=` on the URL, the site keeps it in
`sessionStorage` (so it survives clicking through to other pages), and holding
the scan button looks the citizen up at
`GET /api/v1/public/citizens/:citizenId` on the host the page came from, and shows
their identity card. The id is taken as given, not re-verified.

The kiosk is served by `lspd-backend` itself, so nothing is configured: the
lookup goes to the same host, and the one bundle works on staging and on
production. Set `PUBLIC_LSPD_API_URL` (see `.env.example`) only for a site
served from somewhere else; it is baked into that build. Outside the game, with
neither, the scan reports an error. The code is in `src/lib/citizen.ts` and
`src/scripts/citizen-scan.ts`.

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

## Data for other readers (the phone app)

The Prestige phone's eGov app shows these records too. It never opens this
database: lspd-backend serves a copy of it, read-only, and only through views
whose names start with `public_`. Whatever those views select is public, and
nothing else in the file can be reached, however it is deployed.

| View | Holds |
|---|---|
| `public_records` | The published executive orders, resolutions, memorandums and announcements (an announcement only if it has text to open), with the columns the app reads: `section, id, title, description, number, date, createdAt, content, image, memoTo, memoFrom, subject, pinned, pinOrder, pinExpires`. A picture is kept only if it is an http(s) address. |
| `public_settings` | The mayor's name and picture, and no other setting. |

They are defined by migration 3 (`src/lib/db-schema.ts`) and are the contract with
the app's records (`web/src/apps/egov/types.ts` in prestige-smartphones): a column
added to one is added to the other, as a new migration. Tests fail if the
columns drift, and compare the views with what the site shows, record for record,
on the live data.

**An existing database needs `npm run db:migrate` once** to get the views. Until
then a build or `site:build` says so and stops.

**This site has views of its own, in lspd-backend.** The kiosk site reads more than
the phone does (the forms, the link a document opens, the memorandum's signature, the
hero and the footer), so lspd-backend defines `public_site_records` (every published
record of all five sections, in the column names of this site's own data payload) and
`public_site_settings` (the fifteen settings the site uses, no others) in its migration
5 (`internal/egov/migrations/0005_site_views.sql` there). lspd-backend owns the schema
now; they are not in `src/lib/db-schema.ts`. `fixtures/site-views.json` is a real reply
of the two, and `src/lib/site-source.test.ts` checks that it makes exactly what
`fixtures/live-all.json` makes: if a column changes on either side, that test fails.

### Building the copy for a server

```sh
npm run site:build -- --out site.db
```

Reads this database (it is safe while the dashboard is open) and writes a copy
with the drafts, forms, admin list and numbering counters removed. The file is
rewritten after the deletes, because SQLite keeps a deleted row's bytes until
then; a test searches the finished file for private text. It replaces `--out` if
that is already a database, never writes over the database it reads or a file
that is not a database, and checks the copy before it replaces anything, so a
failed build leaves the last good file alone. The copy is also stamped in its
file header (SQLite's `application_id`, the bytes `PUBD` at offset 68), which the
deploy script reads to refuse any database that is not one, since a wrong path
would otherwise put the drafts and the admin list on a public server. `--db` picks another source (default
`$EGOV_DB_FILE`, then `data/egov.db`).

Putting the file on the server (into lspd-backend's `data/sites/egov/site.db`,
beside its websites folder, never inside it) is done on that machine; see
lspd-backend's `websites/README.md`. In development you can point `EGOV_DB_FILE` at
that path instead, and the dashboard edits what lspd-backend reads; only the
`public_` views are ever reachable.

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
  pages/                   the frames: headings, hero, controls; the content is put in when a page opens
    index.astro            home
    [section]/index.astro  archive: search, sort, pagination
    document.astro         one page for every document, read from ?section=&id= (memorandums get the formal layout)
    assets/snapshot.json.ts  the copy of the content this build was made with (see "The copy")
  components/              Layout, FormViewer, BrandSeal, LoadStatus, CitizenScan, ...
  lib/site-source.ts       where a page gets its content: lspd-backend's views, else the copy
  lib/render.ts            the markup of cards, document pages and the form pop-out, made from the content
  lib/snapshot.ts          the copy a build keeps (and the settings its own markup starts from)
  lib/                     normalising, sorting, markdown, formats
  lib/db.ts, db-schema.ts  the local SQLite database and its migrations (migration 3: the public_ views)
  lib/public-db.ts         the copy of the database for a server (site:build)
  lib/records.ts           create / read / update / delete a section's records, numbering included
  lib/settings.ts          read / save the site settings
  lib/announcements.ts     the same for announcements only (the dashboard uses records.ts)
  lib/admin-api.ts         the dashboard's JSON API; admin-integration.ts adds it to the dev server
  lib/admins.ts            the site_admins whitelist; admin-auth.ts holds sessions and the sign-in limiter
  admin/                   the dashboard page and its script, served only by npm run admin
  lib/i18n.ts, messages/   localization: helpers and the Filipino / English catalogs
  scripts/                 client scripts: egov-page.ts (fetches the content and fills the page), form pop-out, archive search/sort, language switching
  styles/global.css
scripts/build.mjs          build wrapper (staging folder, swapped into dist/ on success)
scripts/db.mjs             db:import / db:export / db:migrate
scripts/site-build.mjs     npm run site:build: the public copy of the database for a server
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
- **How it works:** pages are built, and the content is rendered, in Filipino, so
  there is one build and one set of URLs. Translatable elements carry
  `data-i18n*` attributes (the markup `src/lib/render.ts` makes carries them too)
  and `src/scripts/i18n.ts` swaps the text in the browser, after the content is in.
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
npm test         # unit tests: normalising, sorting, numbering, pins, markdown, database, the data source and the markup
npm run check    # type-check
```

## Things to know

- **The Google Sheet backend is retired.** The site no longer reads from it or
  writes to it, and the `/admin` dashboard that called it is replaced by
  `npm run admin`. `google-apps-script/Code.gs`
  is kept for reference only, and it is out of date: the deployed backend
  returns fields this copy doesn't know about (pinned announcements,
  auto-numbering, memorandum fields, `uploadStatus`). Don't redeploy from it.
- **Images load from where staff put them**, when a page opens. They are no
  longer downloaded, resized and kept in the build, so a kiosk depends on that
  image host (r2.fivemanage.com today) being up. A picture that fails to load
  leaves its symbol. If that matters, copy a record's pictures into lspd-backend's
  site `storage/` when it is published.
- **A page needs JavaScript** to show anything: the content is fetched by the page.
  (The archives already needed it for paging.)
- **A response is capped at 5,000 rows and 8 MB** by lspd-backend. The site reads
  every record at once, so it is fine at a few hundred documents; past that, the
  views would need paging.
- **Archive search covers full document text**, which is in each card. That is
  fine at a few dozen documents; move to a separate search index if the archive
  grows into the hundreds.
- `dist/404.html` is built but `lspd-backend` doesn't serve it; unknown paths
  get its JSON 404.
