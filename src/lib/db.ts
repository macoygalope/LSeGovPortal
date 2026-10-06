import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { MIGRATIONS } from "./db-schema.ts";
import { documentSequence, documentYear } from "./documents.ts";
import {
  normalizeRecord,
  payloadData,
  payloadRows,
  toBool,
  toNumber,
  toText,
} from "./normalize.ts";
import { NUMBERED_SECTIONS, SECTIONS, type NumberedSection, type Section } from "./types.ts";

// A local SQLite copy of the Google Sheet. It speaks the same payload as the
// Apps Script `action=all` endpoint, in both directions, so everything past
// this file (normalizing, sorting, the pages) is shared between the two data
// sources and a build from either gives the same site.

type Kind = "text" | "number" | "bool" | "timestamp";

interface Field {
  /** Key in the Apps Script payload, i.e. the Sheet's column header. */
  key: string;
  /** Column in the `records` table. */
  column: string;
  kind: Kind;
  /** Used when the payload has no usable number. Mirrors normalizeRecord(). */
  fallback?: number;
}

/** Every payload field on a record. `section` is the only other column. */
export const FIELDS: readonly Field[] = [
  { key: "id", column: "id", kind: "text" },
  { key: "title", column: "title", kind: "text" },
  { key: "description", column: "description", kind: "text" },
  { key: "number", column: "number", kind: "text" },
  { key: "date", column: "date", kind: "text" },
  { key: "url", column: "url", kind: "text" },
  { key: "image", column: "image", kind: "text" },
  { key: "icon", column: "icon", kind: "text" },
  { key: "order", column: "sort_order", kind: "number" },
  { key: "published", column: "published", kind: "bool" },
  { key: "content", column: "content", kind: "text" },
  { key: "createdAt", column: "created_at", kind: "timestamp" },
  { key: "updatedAt", column: "updated_at", kind: "timestamp" },
  { key: "autoNumber", column: "auto_number", kind: "bool" },
  { key: "publicationYear", column: "publication_year", kind: "number" },
  { key: "publicationSequence", column: "publication_sequence", kind: "number" },
  { key: "publishedAt", column: "published_at", kind: "text" },
  { key: "pinned", column: "pinned", kind: "bool" },
  { key: "pinOrder", column: "pin_order", kind: "number", fallback: 1 },
  { key: "pinExpires", column: "pin_expires", kind: "text" },
  { key: "subject", column: "subject", kind: "text" },
  { key: "memoTo", column: "memo_to", kind: "text" },
  { key: "memoFrom", column: "memo_from", kind: "text" },
  { key: "watermarkImage", column: "watermark_image", kind: "text" },
  { key: "signatureImage", column: "signature_image", kind: "text" },
  { key: "signatoryName", column: "signatory_name", kind: "text" },
  { key: "signatoryPosition", column: "signatory_position", kind: "text" },
];

const COLUMNS = FIELDS.map((f) => f.column).join(", ");

const INSERT_RECORD = `INSERT INTO records (section, ${COLUMNS})
  VALUES (:section, ${FIELDS.map((f) => `:${f.key}`).join(", ")})`;

/** Moves a series' counter forward, never back. */
const RAISE_NUMBERING = `INSERT INTO numbering (section, year, last_sequence) VALUES (?, ?, ?)
  ON CONFLICT (section, year) DO UPDATE SET
    last_sequence = MAX(last_sequence, excluded.last_sequence),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

const NEXT_SEQUENCE = `INSERT INTO numbering (section, year, last_sequence) VALUES (?, ?, 1)
  ON CONFLICT (section, year) DO UPDATE SET
    last_sequence = last_sequence + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  RETURNING last_sequence`;

type Bound = string | number;

/** A payload value as the column stores it: trimmed text, 0/1, a number, or a timestamp. */
export function bindValue(field: Field, raw: Record<string, unknown>, now: string): Bound {
  const value = raw[field.key];
  switch (field.kind) {
    case "bool":
      return toBool(value) ? 1 : 0;
    case "number":
      return toNumber(value, field.fallback ?? 0);
    case "timestamp":
      return toText(value) || now;
    default:
      return toText(value);
  }
}

function userVersion(db: DatabaseSync): number {
  return Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
}

/** Runs `work` all-or-nothing. Can't be nested: SQLite has no nested BEGIN. */
export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function count(db: DatabaseSync, table: "records" | "settings"): number {
  return Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);
}

/**
 * Opens (creating it, and its folder, if needed) the database at `path`, or an
 * in-memory one for ":memory:", and runs any migrations it hasn't had yet.
 */
export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    const current = userVersion(db);
    if (current > MIGRATIONS.length) {
      throw new Error(
        `${path} has schema version ${current}, but this checkout only knows up to ${MIGRATIONS.length}. Update the code, not the database.`,
      );
    }
    for (let version = current; version < MIGRATIONS.length; version += 1) {
      inTransaction(db, () => {
        db.exec(MIGRATIONS[version]!);
        db.exec(`PRAGMA user_version = ${version + 1}`);
      });
    }
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

export interface ImportSummary {
  settings: number;
  /** Rows stored per section, drafts included. */
  records: Record<Section, number>;
  /** Numbered series (section + year) whose counter was raised. */
  series: number;
}

/**
 * Loads an Apps Script `action=all` payload. Drafts are kept (a build still
 * drops them, see readPayload). Numbering counters are raised to the highest
 * number any imported document already carries -- from the stored year and
 * sequence, else from the printed number, which is all older records have --
 * so the next number handed out cannot collide with one already in use.
 *
 * The database must be empty unless `replace` is set, which clears the
 * records and settings first (but not the numbering high-water marks). It is
 * all-or-nothing: a bad row aborts the import and names the row.
 */
export function importPayload(
  db: DatabaseSync,
  payload: unknown,
  { replace = false }: { replace?: boolean } = {},
): ImportSummary {
  const data = payloadData(payload);
  const sections = SECTIONS.map((section) => [section, payloadRows(data, section)] as const);
  const settings =
    data.SiteSettings && typeof data.SiteSettings === "object"
      ? Object.entries(data.SiteSettings as Record<string, unknown>)
      : [];

  return inTransaction(db, () => {
    const existing = count(db, "records") + count(db, "settings");
    if (existing > 0) {
      if (!replace) {
        throw new Error(
          `The database already has ${existing} rows. Importing would overwrite them: pass replace (--replace) to do that.`,
        );
      }
      db.exec("DELETE FROM records; DELETE FROM settings;");
    }

    const insertSetting = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
    for (const [key, value] of settings) insertSetting.run(key, toText(value));

    const now = new Date().toISOString();
    const insertRecord = db.prepare(INSERT_RECORD);
    const records = {} as Record<Section, number>;
    const highest = new Map<string, [NumberedSection, number, number]>();

    for (const [section, rows] of sections) {
      records[section] = 0;
      for (const row of rows) {
        const raw = row as Record<string, unknown>;
        // Same rule as normalizePayload(): no id, no record.
        if (!toText(raw.id)) continue;

        const values: Record<string, Bound> = { section };
        for (const field of FIELDS) values[field.key] = bindValue(field, raw, now);
        try {
          insertRecord.run(values);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`${section} "${toText(raw.id)}": ${reason}`, { cause: error });
        }
        records[section] += 1;

        if ((NUMBERED_SECTIONS as readonly string[]).includes(section)) {
          const record = normalizeRecord(raw);
          const year = documentYear(record);
          const sequence = documentSequence(record);
          if (year > 0 && sequence > 0) {
            const key = `${section}/${year}`;
            const best = highest.get(key);
            if (!best || sequence > best[2]) highest.set(key, [section as NumberedSection, year, sequence]);
          }
        }
      }
    }

    const raise = db.prepare(RAISE_NUMBERING);
    for (const [section, year, sequence] of highest.values()) raise.run(section, year, sequence);

    return { settings: settings.length, records, series: highest.size };
  });
}

/**
 * Hands out the next sequence number for a numbered section and year (1 for
 * the first). One atomic statement, so two callers can never get the same one.
 */
export function allocateSequence(db: DatabaseSync, section: NumberedSection, year: number): number {
  const row = db.prepare(NEXT_SEQUENCE).get(section, year) as { last_sequence: number };
  return Number(row.last_sequence);
}

/**
 * Makes sure the next number handed out is past `sequence`, for a document
 * that was numbered by hand. Moves the counter forward, never back.
 */
export function raiseSequence(db: DatabaseSync, section: NumberedSection, year: number, sequence: number): void {
  db.prepare(RAISE_NUMBERING).run(section, year, sequence);
}

/**
 * The database as an Apps Script `action=all` payload, so it can go straight
 * through normalizePayload(). Like that endpoint it leaves drafts out unless
 * asked, which keeps a draft from reaching the static output even before
 * normalizePayload() filters it.
 */
export function readPayload(
  db: DatabaseSync,
  { includeDrafts = false }: { includeDrafts?: boolean } = {},
): { ok: true; data: Record<string, unknown> } {
  const siteSettings: Record<string, string> = {};
  for (const row of db.prepare("SELECT key, value FROM settings ORDER BY key").all()) {
    siteSettings[String(row.key)] = String(row.value);
  }

  // Same order the Sheet backend returns: admin order, then newest date.
  const select = db.prepare(
    `SELECT ${COLUMNS} FROM records WHERE section = ?${includeDrafts ? "" : " AND published = 1"}
     ORDER BY sort_order, date DESC, rowid`,
  );

  const data: Record<string, unknown> = { SiteSettings: siteSettings };
  for (const section of SECTIONS) {
    data[section] = select.all(section).map((row) =>
      Object.fromEntries(
        FIELDS.map((f) => [f.key, f.kind === "bool" ? row[f.column] === 1 : row[f.column]]),
      ),
    );
  }
  return { ok: true, data };
}

/**
 * What a build reads unless EGOV_DATA_FILE is set. Opens read-only and refuses
 * a missing or never-initialised file: opening would otherwise create an empty
 * database and the build would quietly publish an empty site.
 */
export function readPayloadFromFile(path: string): ReturnType<typeof readPayload> {
  if (!existsSync(path)) {
    throw new Error(
      `The eGov database "${path}" does not exist (set EGOV_DB_FILE to use another path). Create it with: npm run db:import -- --file fixtures/live-all.json`,
    );
  }
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const version = userVersion(db);
    if (version !== MIGRATIONS.length) {
      throw new Error(
        version === 0
          ? `"${path}" is not an eGov database (it has no schema). Create one with: npm run db:import`
          : `"${path}" has schema version ${version}; this checkout expects ${MIGRATIONS.length}. Run: npm run db:migrate`,
      );
    }
    return readPayload(db);
  } finally {
    db.close();
  }
}
