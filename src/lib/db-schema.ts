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
];
