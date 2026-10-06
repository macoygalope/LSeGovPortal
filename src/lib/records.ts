import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { FIELDS, allocateSequence, bindValue, inTransaction, raiseSequence } from "./db.ts";
import { MAX_PINNED_ANNOUNCEMENTS, documentSequence, documentYear } from "./documents.ts";
import { normalizeRecord, toBool, toNumber, toText } from "./normalize.ts";
import {
  NUMBERED_SECTIONS,
  SECTIONS,
  type EgovRecord,
  type NumberedSection,
  type Section,
} from "./types.ts";
import { AdminError, checkLength, checkUrl, isIsoDate } from "./validation.ts";

// Create, read, update and delete for every section of the local database (see
// db.ts), as the admin dashboard needs them. It does what the Apps Script
// backend's `upsert` used to: refuse what the sheet refused, and hand out the
// next document number the first time a numbered document is published.
// Writes go to `records`, and only to the columns a section uses: the
// memorandum fields the sheet also fills on other tabs are never touched.
//
// announcements.ts is the older, announcements-only version of this.

const MAX_CONTENT_LENGTH = 45000;

/** A record as stored: what the site reads, plus whether it numbers itself and when it was saved. */
export interface StoredRecord extends EgovRecord {
  autoNumber: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What can be set on a record. Which of these a section uses is `EDITABLE`; the rest are ignored. */
export interface RecordInput {
  /** A new UUID when left out, like the backend. */
  id?: string;
  /** Memorandums take theirs from `subject`. */
  title?: string;
  description?: string;
  /** Printed number. Numbered sections fill it in when `autoNumber` is on. */
  number?: string;
  /** `YYYY-MM-DD`. Required for numbered sections. */
  date?: string;
  /** External link. Forms need it; every other section needs it or `content`. */
  url?: string;
  image?: string;
  icon?: string;
  /** Admin order, lowest first. Defaults to 0. */
  order?: number;
  /** Drafts (the default) are kept but never reach a build. */
  published?: boolean;
  /** The full text, up to 45,000 characters. */
  content?: string;
  /** Numbered sections: give the next number the first time it is published. Defaults to on. */
  autoNumber?: boolean;

  // Announcements.
  pinned?: boolean;
  /** 1 to 3, lowest first, while pinned. Defaults to 1. */
  pinOrder?: number;
  /** Last day of the pin as `YYYY-MM-DD`, or empty for no expiry. */
  pinExpires?: string;

  // Memorandums.
  subject?: string;
  memoTo?: string;
  memoFrom?: string;
  signatureImage?: string;
  signatoryName?: string;
  signatoryPosition?: string;
}

/** Fields to change on an existing record; anything left out (or undefined) stays as it is. */
export type RecordChanges = Omit<RecordInput, "id">;

type Field = (typeof FIELDS)[number];

const FIELD = new Map<string, Field>(FIELDS.map((f) => [f.key, f]));
const COLUMNS = FIELDS.map((f) => f.column).join(", ");

const SHARED = [
  "title",
  "description",
  "date",
  "url",
  "image",
  "icon",
  "order",
  "published",
  "content",
] as const;
const MEMORANDUM = [
  "subject",
  "memoTo",
  "memoFrom",
  "signatureImage",
  "signatoryName",
  "signatoryPosition",
] as const;

/** The fields each section lets staff set. Anything else in a request is ignored. */
const EDITABLE: Record<Section, readonly string[]> = {
  Forms: SHARED,
  Announcements: [...SHARED, "number", "pinned", "pinOrder", "pinExpires"],
  ExecutiveOrders: [...SHARED, "number", "autoNumber"],
  Memorandums: [...SHARED, "number", "autoNumber", ...MEMORANDUM],
  Resolutions: [...SHARED, "number", "autoNumber"],
};

/** Longest text each field takes (the dashboard's `maxlength`s). Content has its own check. */
const MAX_LENGTH: Record<string, number> = {
  title: 180,
  description: 1200,
  number: 100,
  icon: 12,
  subject: 500,
  memoTo: 500,
  memoFrom: 500,
  signatoryName: 160,
  signatoryPosition: 180,
};

const URL_FIELDS = ["url", "image", "signatureImage"] as const;

/** Numbering also moves these, so an update writes them for the sections that number. */
const NUMBERING = ["publicationYear", "publicationSequence", "publishedAt"] as const;

const INSERT = `INSERT INTO records (section, ${COLUMNS})
  VALUES (:section, ${FIELDS.map((f) => `:${f.key}`).join(", ")})`;

const UPDATES = new Map<Section, { keys: string[]; sql: string }>();

function updateFor(section: Section): { keys: string[]; sql: string } {
  let update = UPDATES.get(section);
  if (!update) {
    const keys = [
      ...new Set([...EDITABLE[section], "updatedAt", ...(isNumbered(section) ? NUMBERING : [])]),
    ];
    const set = keys.map((key) => `${FIELD.get(key)!.column} = :${key}`).join(", ");
    update = { keys, sql: `UPDATE records SET ${set} WHERE section = :section AND id = :id` };
    UPDATES.set(section, update);
  }
  return update;
}

function isNumbered(section: Section): section is NumberedSection {
  return (NUMBERED_SECTIONS as readonly string[]).includes(section);
}

/** `section` as a known section, or a 400 that says so. */
export function parseSection(section: string): Section {
  if ((SECTIONS as readonly string[]).includes(section)) return section as Section;
  throw new AdminError("badSection", `"${section}" is not a section.`);
}

/**
 * The printed number the dashboard hands out, in the shapes the live
 * documents use. documentYear() and documentSequence() read these back.
 */
export function formatNumber(section: NumberedSection, year: number, sequence: number): string {
  const n = String(sequence).padStart(2, "0");
  if (section === "Memorandums") return `Memorandum Blg. ${year}-${n}`;
  const name = section === "Resolutions" ? "Resolusyon" : "Executive Order";
  return `${name} Blg. ${n}, Serye ng ${year}`;
}

function toStored(row: Record<string, unknown>): StoredRecord {
  const raw = Object.fromEntries(
    FIELDS.map((f) => [f.key, f.kind === "bool" ? row[f.column] === 1 : row[f.column]]),
  );
  return {
    ...normalizeRecord(raw),
    autoNumber: raw.autoNumber === true,
    createdAt: toText(raw.createdAt),
    updatedAt: toText(raw.updatedAt),
  };
}

function notFound(section: Section, id: string): AdminError {
  return new AdminError("recordNotFound", `"${id}" was not found in ${section}.`, { status: 404 });
}

/** One record, or undefined if the section has none with that id. */
export function getRecord(db: DatabaseSync, section: Section, id: string): StoredRecord | undefined {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM records WHERE section = ? AND id = ?`)
    .get(section, toText(id));
  return row && toStored(row);
}

/**
 * A section's records in the order the sheet backend returns them: admin
 * order, then newest date. Drafts are left out unless asked for.
 */
export function listRecords(
  db: DatabaseSync,
  section: Section,
  { includeDrafts = false }: { includeDrafts?: boolean } = {},
): StoredRecord[] {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM records WHERE section = ?${includeDrafts ? "" : " AND published = 1"}
       ORDER BY sort_order, date DESC, rowid`,
    )
    .all(section)
    .map(toStored);
}

function textOf(raw: Record<string, unknown>, key: string): string {
  return toText(raw[key]);
}

function coerce(key: string, value: unknown): string | number | boolean {
  const field = FIELD.get(key)!;
  if (field.kind === "bool") return toBool(value);
  if (field.kind === "number") return toNumber(value, field.fallback ?? 0);
  return toText(value);
}

/** Refuses what the sheet backend refused, and a few things it should have. */
function check(section: Section, raw: Record<string, unknown>): void {
  const text = (key: string) => textOf(raw, key);

  if (section === "Memorandums") {
    for (const field of ["subject", "memoTo", "memoFrom"]) {
      if (!text(field)) {
        throw new AdminError("needMemoFields", "A memorandum needs a subject, a recipient and a sender.", { field });
      }
    }
  }
  if (!text("title")) throw new AdminError("needTitle", "A title is required.", { field: "title" });

  if (text("content").length > MAX_CONTENT_LENGTH) {
    throw new AdminError("contentTooLong", "The full content is limited to 45,000 characters.", {
      field: "content",
    });
  }
  for (const [field, max] of Object.entries(MAX_LENGTH)) {
    // A memorandum's title is its subject, which is allowed to be longer.
    if (section === "Memorandums" && field === "title") continue;
    if (EDITABLE[section].includes(field)) checkLength(field, text(field), max);
  }

  if (section === "Forms") {
    if (!text("url")) throw new AdminError("needFormLink", "A form needs its link.", { field: "url" });
  } else if (!text("content") && !text("url")) {
    throw new AdminError("needContent", "Enter the full content or an external link.", { field: "content" });
  }
  for (const field of URL_FIELDS) {
    if (EDITABLE[section].includes(field)) checkUrl(field, text(field));
  }

  if (isNumbered(section) && !text("date")) {
    throw new AdminError("needDate", "A numbered document needs a date.", { field: "date" });
  }
  for (const field of ["date", "pinExpires"]) {
    if (EDITABLE[section].includes(field) && text(field) && !isIsoDate(text(field))) {
      throw new AdminError("badDate", `"${field}" must look like 2026-12-31.`, { field });
    }
  }

  if (section === "Announcements" && raw.pinned) {
    const order = Number(raw.pinOrder);
    if (!Number.isInteger(order) || order < 1 || order > MAX_PINNED_ANNOUNCEMENTS) {
      throw new AdminError(
        "badPinOrder",
        `The pin order must be a whole number from 1 to ${MAX_PINNED_ANNOUNCEMENTS}.`,
        { field: "pinOrder", vars: { max: MAX_PINNED_ANNOUNCEMENTS } },
      );
    }
  }
}

/**
 * Numbers a numbered document the first time it is published: the year and
 * time are fixed then, and an automatic document takes the next number in its
 * series. An already numbered one keeps its number, and a manual one must
 * have it typed in.
 */
function publish(
  db: DatabaseSync,
  section: NumberedSection,
  raw: Record<string, unknown>,
  current: StoredRecord | undefined,
  now: string,
): void {
  if (!raw.publicationYear) raw.publicationYear = Number(textOf(raw, "date").slice(0, 4));
  if (!raw.publishedAt) raw.publishedAt = now;

  if (!raw.autoNumber) {
    if (!textOf(raw, "number")) {
      throw new AdminError("needNumber", "Enter a number, or choose automatic numbering.", { field: "number" });
    }
  } else if (raw.publicationSequence) {
    raw.number = current?.number ?? "";
  } else {
    const year = Number(raw.publicationYear);
    const sequence = allocateSequence(db, section, year);
    raw.publicationSequence = sequence;
    raw.number = formatNumber(section, year, sequence);
  }
}

function save(
  db: DatabaseSync,
  section: Section,
  id: string,
  current: StoredRecord | undefined,
  changes: RecordChanges,
): StoredRecord {
  const now = new Date().toISOString();
  const raw: Record<string, unknown> = current
    ? { ...current }
    : { id, autoNumber: isNumbered(section), pinOrder: 1, createdAt: now };

  for (const [key, value] of Object.entries(changes)) {
    if (value !== undefined && EDITABLE[section].includes(key)) raw[key] = coerce(key, value);
  }
  // A memorandum is listed by its subject.
  if (section === "Memorandums") raw.title = textOf(raw, "subject");
  check(section, raw);

  if (isNumbered(section) && raw.published) publish(db, section, raw, current, now);
  raw.updatedAt = now;

  try {
    if (current) {
      const { keys, sql } = updateFor(section);
      const values: Record<string, string | number> = { section, id };
      for (const key of keys) values[key] = bindValue(FIELD.get(key)!, raw, now);
      db.prepare(sql).run(values);
    } else {
      const values: Record<string, string | number> = { section };
      for (const field of FIELDS) values[field.key] = bindValue(field, raw, now);
      db.prepare(INSERT).run(values);
    }
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed.*publication_sequence/.test(error.message)) {
      throw new AdminError("numberTaken", "Another document already has that number.", {
        status: 409,
        field: "number",
      });
    }
    throw error;
  }

  // A hand-typed number takes its place in the series, so the next automatic
  // one can't repeat it.
  if (isNumbered(section) && raw.published && !raw.autoNumber) {
    const record = normalizeRecord(raw);
    const year = documentYear(record);
    const sequence = documentSequence(record);
    if (year > 0 && sequence > 0) raiseSequence(db, section, year, sequence);
  }

  return getRecord(db, section, id)!;
}

/** Saves a new record and returns it as stored. Throws if the id is already taken in that section. */
export function createRecord(db: DatabaseSync, section: Section, input: RecordInput): StoredRecord {
  const id = toText(input.id) || randomUUID();
  return inTransaction(db, () => {
    if (getRecord(db, section, id)) {
      throw new AdminError("idTaken", `"${id}" is already used in ${section}.`, { status: 409, field: "id" });
    }
    return save(db, section, id, undefined, input);
  });
}

/**
 * Changes some fields of a record and returns it as stored. The result is
 * checked as a whole, so clearing the only content a record has is refused,
 * and a refused change leaves the record as it was. `createdAt` is kept.
 */
export function updateRecord(db: DatabaseSync, section: Section, id: string, changes: RecordChanges): StoredRecord {
  const key = toText(id);
  return inTransaction(db, () => {
    const current = getRecord(db, section, key);
    if (!current) throw notFound(section, key);
    return save(db, section, key, current, changes);
  });
}

/** Removes a record for good. Its number is not handed out again. Throws if there is none with that id. */
export function deleteRecord(db: DatabaseSync, section: Section, id: string): void {
  const key = toText(id);
  const { changes } = db.prepare("DELETE FROM records WHERE section = ? AND id = ?").run(section, key);
  if (Number(changes) === 0) throw notFound(section, key);
}
