/**
 * Schema for the local eGov database (see db.ts), as an append-only list of
 * migrations. A database stores how many have run in `PRAGMA user_version`, so
 * never edit one that has shipped: add a new entry instead. The section names
 * in the SQL are literals on purpose (a migration must not change when
 * `SECTIONS` does); db.test.ts fails if they drift from types.ts.
 *
 * The tables mirror the Google Sheet: one `records` table where the Sheet has
 * one tab per section, plus `settings` (the Settings tab) and `numbering` (the
 * Numbering tab). Columns that only matter to one section (pins, memorandum
 * fields, publication numbers) stay on `records` rather than in side tables,
 * because the Sheet fills them on every tab -- the live data has `subject` on
 * forms and announcements too -- and a narrower schema would drop that on
 * import. The per-section views below give the one-tab-per-section look back.
 *
 * Migration 2 is the one table with no sheet equivalent: `site_admins`, the
 * whitelist for the admin dashboard.
 *
 * Migration 3 is not data at all: the `public_*` views, which are everything
 * another reader of this database (the Prestige phone app, through
 * lspd-backend) is allowed to see. See there.
 */
export const MIGRATIONS: readonly string[] = [
  // 1: initial schema
  `
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE records (
  section TEXT NOT NULL,
  id      TEXT NOT NULL,
  title   TEXT NOT NULL,

  description TEXT NOT NULL DEFAULT '',
  number      TEXT NOT NULL DEFAULT '',
  -- ISO date as entered in the admin, or ''. The site sorts dates as strings.
  date        TEXT NOT NULL DEFAULT '',
  -- External link: the Google Form, or a signed copy.
  url         TEXT NOT NULL DEFAULT '',
  image       TEXT NOT NULL DEFAULT '',
  icon        TEXT NOT NULL DEFAULT '',
  sort_order  REAL NOT NULL DEFAULT 0,
  published   INTEGER NOT NULL DEFAULT 0,
  content     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- Numbered documents (executive orders, memorandums, resolutions).
  auto_number          INTEGER NOT NULL DEFAULT 0,
  publication_year     INTEGER NOT NULL DEFAULT 0,
  publication_sequence INTEGER NOT NULL DEFAULT 0,
  published_at         TEXT    NOT NULL DEFAULT '',

  -- Announcements: up to three active pins, shown first.
  pinned      INTEGER NOT NULL DEFAULT 0,
  pin_order   INTEGER NOT NULL DEFAULT 0,
  pin_expires TEXT    NOT NULL DEFAULT '',

  -- Memorandums.
  subject            TEXT NOT NULL DEFAULT '',
  memo_to            TEXT NOT NULL DEFAULT '',
  memo_from          TEXT NOT NULL DEFAULT '',
  watermark_image    TEXT NOT NULL DEFAULT '',
  signature_image    TEXT NOT NULL DEFAULT '',
  signatory_name     TEXT NOT NULL DEFAULT '',
  signatory_position TEXT NOT NULL DEFAULT '',

  PRIMARY KEY (section, id),
  CONSTRAINT section_is_known CHECK (section IN
    ('Forms', 'Announcements', 'ExecutiveOrders', 'Memorandums', 'Resolutions')),
  CONSTRAINT id_not_empty CHECK (id <> ''),
  CONSTRAINT title_not_empty CHECK (title <> ''),
  CONSTRAINT date_is_iso CHECK (
    date = '' OR date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT pin_expires_is_iso CHECK (
    pin_expires = '' OR pin_expires GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT flags_are_boolean CHECK (
    published IN (0, 1) AND pinned IN (0, 1) AND auto_number IN (0, 1)),
  CONSTRAINT numbers_not_negative CHECK (
    publication_year >= 0 AND publication_sequence >= 0 AND pin_order >= 0),
  -- The backend refuses a form without its Google Form link.
  CONSTRAINT forms_have_a_link CHECK (section <> 'Forms' OR url <> '')
) STRICT;

-- No two documents in a series may share a stored number. Records that only
-- have a printed number (publication_sequence = 0) are exempt: the live
-- executive orders include a duplicated "Blg. 09".
CREATE UNIQUE INDEX records_publication_number
  ON records (section, publication_year, publication_sequence)
  WHERE publication_sequence > 0;

-- Last sequence handed out per numbered section and year. It only moves
-- forward, so deleting a document never frees its number.
CREATE TABLE numbering (
  section       TEXT    NOT NULL,
  year          INTEGER NOT NULL,
  last_sequence INTEGER NOT NULL,
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (section, year),
  CONSTRAINT section_is_numbered CHECK (section IN
    ('ExecutiveOrders', 'Memorandums', 'Resolutions')),
  CONSTRAINT year_is_positive CHECK (year > 0),
  CONSTRAINT sequence_not_negative CHECK (last_sequence >= 0)
) STRICT;

-- One read-only view per section, with only the columns that section uses.
CREATE VIEW forms AS
  SELECT id, title, description, url, icon, sort_order, published, created_at, updated_at
  FROM records WHERE section = 'Forms';

CREATE VIEW announcements AS
  SELECT id, title, description, number, date, url, image, icon, sort_order, published,
         content, pinned, pin_order, pin_expires, created_at, updated_at
  FROM records WHERE section = 'Announcements';

CREATE VIEW executive_orders AS
  SELECT id, title, description, number, date, url, image, icon, sort_order, published,
         content, auto_number, publication_year, publication_sequence, published_at,
         created_at, updated_at
  FROM records WHERE section = 'ExecutiveOrders';

CREATE VIEW memorandums AS
  SELECT id, title, description, number, date, url, image, icon, sort_order, published,
         content, auto_number, publication_year, publication_sequence, published_at,
         subject, memo_to, memo_from, watermark_image, signature_image,
         signatory_name, signatory_position, created_at, updated_at
  FROM records WHERE section = 'Memorandums';

CREATE VIEW resolutions AS
  SELECT id, title, description, number, date, url, image, icon, sort_order, published,
         content, auto_number, publication_year, publication_sequence, published_at,
         created_at, updated_at
  FROM records WHERE section = 'Resolutions';
`,

  // 2: who may use the admin dashboard
  `
-- The citizens allowed to sign in to the admin dashboard, by the citizenid
-- the game gives them. Nothing like it exists in the sheet, so an import never
-- touches it. NOCASE because a citizenid is the same person however it is typed.
CREATE TABLE site_admins (
  citizenid  TEXT PRIMARY KEY COLLATE NOCASE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT citizenid_not_empty CHECK (citizenid <> ''),
  CONSTRAINT name_not_empty CHECK (name <> '')
) STRICT;
`,

  // 3: what other readers may see
  `
-- lspd-backend serves this database to the phone app, but only through views
-- whose names start with public_: it lists and reads those and nothing else, so
-- whatever is not selected here cannot be reached, drafts and the admin list
-- included. These views ARE the contract with the phone app's records
-- (web/src/apps/egov/types.ts in prestige-smartphones): the same names, in
-- camelCase because that is what the app reads. Add a column here and there
-- together, and as a new migration; this one must not change once it ships.
--
-- Published documents only, and an announcement only if it has text to open
-- (the live welcome post has none). A picture is shown only if it is an http(s)
-- URL, so a bad value cannot become a file: or javascript: reference in the app.
CREATE VIEW public_records AS
  SELECT section, id, title, description, number, date,
         created_at AS createdAt,
         content,
         CASE WHEN lower(substr(image, 1, 7)) = 'http://' OR lower(substr(image, 1, 8)) = 'https://'
              THEN image ELSE '' END AS image,
         memo_to AS memoTo, memo_from AS memoFrom, subject,
         pinned, pin_order AS pinOrder, pin_expires AS pinExpires
  FROM records
  WHERE published = 1
    AND section IN ('ExecutiveOrders', 'Resolutions', 'Memorandums', 'Announcements')
    AND (section <> 'Announcements' OR trim(content, char(32, 9, 10, 13)) <> '');

-- The mayor on the Officials screen, and nothing else of the site settings.
CREATE VIEW public_settings AS
  SELECT key,
         CASE WHEN key = 'mayorImageUrl'
                   AND NOT (lower(substr(value, 1, 7)) = 'http://' OR lower(substr(value, 1, 8)) = 'https://')
              THEN '' ELSE value END AS value
  FROM settings
  WHERE key IN ('mayorName', 'mayorImageUrl');
`,
];
