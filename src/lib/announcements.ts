import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { FIELDS, bindValue, inTransaction } from "./db.ts";
import { MAX_PINNED_ANNOUNCEMENTS } from "./documents.ts";
import { normalizeRecord, toText } from "./normalize.ts";
import type { EgovRecord } from "./types.ts";

// Create, read, update and delete for the Announcements section of the local
// database (see db.ts). Writes go to `records`, because the `announcements`
// view is read-only; columns the view doesn't have (the memorandum fields the
// sheet also fills on this tab) are never touched. The checks mirror the
// Apps Script `upsert` action, so a record saved here is one the sheet would
// have accepted, and the wording of the errors matches `Code.gs`.

const SECTION = "Announcements";
const MAX_CONTENT_LENGTH = 45000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** An announcement as stored: what the site reads, plus when it was saved. */
export interface Announcement extends EgovRecord {
  createdAt: string;
  updatedAt: string;
}

/** What can be set on an announcement. Only the title is always required. */
export interface AnnouncementInput {
  /** A new UUID when left out, like the backend. */
  id?: string;
  title: string;
  description?: string;
  number?: string;
  /** `YYYY-MM-DD`, or empty. */
  date?: string;
  /** External link. A record needs this or `content`. */
  url?: string;
  image?: string;
  icon?: string;
  /** Admin order, lowest first. Defaults to 0. */
  order?: number;
  /** Drafts (the default) are kept but never reach a build. */
  published?: boolean;
  /** The full text, up to 45,000 characters. */
  content?: string;
  pinned?: boolean;
  /** 1 to 3, lowest first, while pinned. Defaults to 1. */
  pinOrder?: number;
  /** Last day of the pin as `YYYY-MM-DD`, or empty for no expiry. */
  pinExpires?: string;
}

/** Fields to change on an existing announcement; anything left out (or undefined) stays as it is. */
export type AnnouncementChanges = Partial<Omit<AnnouncementInput, "id">>;

type Values = Record<string, string | number>;

const EDITABLE: ReadonlySet<string> = new Set([
  "title",
  "description",
  "number",
  "date",
  "url",
  "image",
  "icon",
  "order",
  "published",
  "content",
  "pinned",
  "pinOrder",
  "pinExpires",
]);

/** The columns of the `announcements` view. */
const READ_FIELDS = FIELDS.filter((f) => f.key === "id" || f.kind === "timestamp" || EDITABLE.has(f.key));
/** What an update rewrites. `createdAt` is set once, and `id` only picks the row. */
const UPDATE_FIELDS = READ_FIELDS.filter((f) => f.key !== "createdAt");

const READ_COLUMNS = READ_FIELDS.map((f) => f.column).join(", ");

const INSERT = `INSERT INTO records (section, ${READ_COLUMNS})
  VALUES ('${SECTION}', ${READ_FIELDS.map((f) => `:${f.key}`).join(", ")})
  ON CONFLICT (section, id) DO NOTHING`;

const UPDATE = `UPDATE records
  SET ${UPDATE_FIELDS.filter((f) => f.key !== "id")
    .map((f) => `${f.column} = :${f.key}`)
    .join(", ")}
  WHERE section = '${SECTION}' AND id = :id`;

function notFound(id: string): Error {
  return new Error(`Announcement "${id}" was not found.`);
}

function toAnnouncement(row: Record<string, unknown>): Announcement {
  const raw = Object.fromEntries(
    READ_FIELDS.map((f) => [f.key, f.kind === "bool" ? row[f.column] === 1 : row[f.column]]),
  );
  return { ...normalizeRecord(raw), createdAt: toText(raw.createdAt), updatedAt: toText(raw.updatedAt) };
}

/** Binds `fields` from `raw` the way an import does, then refuses what the sheet backend would. */
function bindChecked(fields: typeof READ_FIELDS, raw: Record<string, unknown>, now: string): Values {
  const values: Values = Object.fromEntries(fields.map((f) => [f.key, bindValue(f, raw, now)]));

  if (!values.title) throw new Error("A title is required.");
  if (String(values.content).length > MAX_CONTENT_LENGTH) {
    throw new Error("The full content is limited to 45,000 characters.");
  }
  if (!values.content && !values.url) throw new Error("Enter the full content or an external link.");
  for (const [key, label] of [
    ["date", "The date"],
    ["pinExpires", "The last day of the pin"],
  ] as const) {
    if (values[key] && !ISO_DATE.test(String(values[key]))) {
      throw new Error(`${label} must look like 2026-12-31.`);
    }
  }
  if (values.pinned) {
    const order = Number(values.pinOrder);
    if (!Number.isInteger(order) || order < 1 || order > MAX_PINNED_ANNOUNCEMENTS) {
      throw new Error(`The pin order must be a whole number from 1 to ${MAX_PINNED_ANNOUNCEMENTS}.`);
    }
  }
  return values;
}

/** One announcement, or undefined if there is none with that id. */
export function getAnnouncement(db: DatabaseSync, id: string): Announcement | undefined {
  const row = db
    .prepare(`SELECT ${READ_COLUMNS} FROM records WHERE section = ? AND id = ?`)
    .get(SECTION, toText(id));
  return row && toAnnouncement(row);
}

/**
 * Announcements in the order the sheet backend returns them: admin order, then
 * newest date. Like its `list` action, drafts are left out unless asked for.
 * To show them as the site does (pins first), pass them to orderedAnnouncements().
 */
export function listAnnouncements(
  db: DatabaseSync,
  { includeDrafts = false }: { includeDrafts?: boolean } = {},
): Announcement[] {
  return db
    .prepare(
      `SELECT ${READ_COLUMNS} FROM records WHERE section = ?${includeDrafts ? "" : " AND published = 1"}
       ORDER BY sort_order, date DESC, rowid`,
    )
    .all(SECTION)
    .map(toAnnouncement);
}

/** Saves a new announcement and returns it as stored. Throws if the id is already taken. */
export function createAnnouncement(db: DatabaseSync, input: AnnouncementInput): Announcement {
  const now = new Date().toISOString();
  const id = toText(input.id) || randomUUID();
  const values = bindChecked(READ_FIELDS, { ...input, id, createdAt: now, updatedAt: now }, now);

  const { changes } = db.prepare(INSERT).run(values);
  if (Number(changes) === 0) throw new Error(`Announcement "${id}" already exists.`);
  return getAnnouncement(db, id)!;
}

/**
 * Changes some fields of an announcement and returns it as stored. The result
 * is checked as a whole, so clearing the only content a record has is refused,
 * and a refused change leaves the record as it was. `createdAt` is kept.
 */
export function updateAnnouncement(db: DatabaseSync, id: string, changes: AnnouncementChanges): Announcement {
  const key = toText(id);
  return inTransaction(db, () => {
    const current = getAnnouncement(db, key);
    if (!current) throw notFound(key);

    const now = new Date().toISOString();
    const raw: Record<string, unknown> = { ...current };
    for (const [field, value] of Object.entries(changes)) {
      if (value !== undefined && EDITABLE.has(field)) raw[field] = value;
    }
    db.prepare(UPDATE).run(bindChecked(UPDATE_FIELDS, { ...raw, updatedAt: now }, now));
    return getAnnouncement(db, key)!;
  });
}

/** Removes an announcement for good. Throws if there is none with that id. */
export function deleteAnnouncement(db: DatabaseSync, id: string): void {
  const key = toText(id);
  const { changes } = db.prepare("DELETE FROM records WHERE section = ? AND id = ?").run(SECTION, key);
  if (Number(changes) === 0) throw notFound(key);
}
