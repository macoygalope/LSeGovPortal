import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { MIGRATIONS } from "./db-schema.ts";
import { DOCUMENT_SECTIONS } from "./types.ts";

/**
 * The copy of the database that goes on a server.
 *
 * The database being edited holds drafts, forms, the admin list and the
 * numbering counters. None of that belongs on the machine that serves the
 * public, so this builds a second file with only what the public views
 * (migration 3) can show: the published documents and the site settings. It is
 * what lspd-backend reads, read-only, through those views.
 *
 * Deleting the private rows is not enough: SQLite leaves a deleted row's bytes in
 * the file until the file is rewritten, so the copy is rewritten after the
 * deletes (VACUUM INTO), and a test searches the finished file for the private
 * text to prove it.
 */

export interface PublicBuild {
  out: string;
  bytes: number;
  /** The schema version, the same as the database it was built from. */
  schema: number;
  /** Rows in public_records, per section. */
  records: Record<string, number>;
  /** Rows in public_settings. */
  settings: number;
  /** What the copy left out, as counts only. */
  removed: { records: number; admins: number; numbering: number };
}

const SQLITE_HEADER = "SQLite format 3\u0000";

/**
 * Written into every public copy's file header (SQLite's application_id, the
 * four bytes "PUBD" at offset 68) so a deploy can tell a built copy from the
 * database being edited, which holds drafts and the admin list. Nothing there
 * can open the file to look, but anything can read these four bytes. The
 * database you edit has 0 there. Deploy scripts compare against this value
 * (deploy-site.ps1 in prestige-nginx), so it must not change.
 */
export const PUBLIC_COPY_APPLICATION_ID = 0x50554244;

function userVersion(db: DatabaseSync): number {
  return Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
}

function sameFile(a: string, b: string): boolean {
  const norm = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);
  if (norm(a) === norm(b)) return true;
  try {
    const first = statSync(a, { bigint: true });
    const second = statSync(b, { bigint: true });
    return first.ino !== 0n && first.dev === second.dev && first.ino === second.ino;
  } catch {
    return false;
  }
}

/** An existing output may only be replaced if it is empty or already a SQLite file. */
function refuseToClobber(out: string): void {
  if (!existsSync(out)) return;
  const info = statSync(out);
  if (!info.isFile()) throw new Error(`"${out}" is not a file, so it cannot be the output.`);
  if (info.size === 0) return;
  const fd = openSync(out, "r");
  try {
    const head = Buffer.alloc(SQLITE_HEADER.length);
    readSync(fd, head, 0, head.length, 0);
    if (head.toString("latin1") !== SQLITE_HEADER) {
      throw new Error(`Refusing to overwrite "${out}": it is not a SQLite database. Pick another --out.`);
    }
  } finally {
    closeSync(fd);
  }
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Renames over `to`, waiting a little if something has it open (as lspd-backend briefly does when it reads). */
function replaceFile(from: string, to: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= 30 || !["EPERM", "EBUSY", "EACCES"].includes(code)) {
        throw new Error(
          `Could not replace "${to}" (${code || "unknown error"}). If something has it open, stop it or write to another file.`,
          { cause: error },
        );
      }
      sleep(100);
    }
  }
}

function sectionList(): string {
  return DOCUMENT_SECTIONS.map((section) => `'${section}'`).join(", ");
}

/** Checks a finished copy before it replaces anything, and reports what is in it. */
function verify(path: string, schema: number): Pick<PublicBuild, "records" | "settings"> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    const count = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
    const problems: string[] = [];
    if (integrity !== "ok") problems.push(`integrity check says "${integrity}"`);
    if (userVersion(db) !== schema) problems.push("the schema version changed");
    const marked = Number((db.prepare("PRAGMA application_id").get() as { application_id: number }).application_id);
    if (marked !== PUBLIC_COPY_APPLICATION_ID) problems.push("it is not marked as a public copy");
    if (count(`SELECT count(*) AS n FROM records WHERE published <> 1 OR section NOT IN (${sectionList()})`) !== 0) {
      problems.push("it still has drafts or non-document records");
    }
    if (count("SELECT count(*) AS n FROM site_admins") !== 0) problems.push("it still has site admins");
    if (count("SELECT count(*) AS n FROM numbering") !== 0) problems.push("it still has numbering rows");
    const views = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'view' AND name IN ('public_records', 'public_settings')")
      .all();
    if (views.length !== 2) problems.push("a public view is missing");
    if (problems.length) throw new Error(`The built database failed its own check: ${problems.join("; ")}.`);

    const records: Record<string, number> = Object.fromEntries(DOCUMENT_SECTIONS.map((section) => [section, 0]));
    for (const row of db.prepare("SELECT section, count(*) AS n FROM public_records GROUP BY section").all()) {
      records[String(row.section)] = Number(row.n);
    }
    return { records, settings: count("SELECT count(*) AS n FROM public_settings") };
  } finally {
    db.close();
  }
}

/**
 * Builds the public copy of the database at `source` into the file `out`,
 * replacing `out` if it is already a database. The source is only read, so an
 * edit in progress is fine, and `out` is written beside itself and renamed into
 * place only once it has checked out, so a failed build leaves the last good
 * file alone.
 *
 * Refuses to write over its own source, over a file that is not a SQLite
 * database, or from a source that has not had migration 3 (run `npm run
 * db:migrate`). `workDir` is where the intermediate file goes (default: the
 * system temp folder); it holds the private rows and is removed afterwards.
 */
export function buildPublicDatabase(source: string, out: string, options: { workDir?: string } = {}): PublicBuild {
  const from = resolve(source);
  const to = resolve(out);
  if (!existsSync(from)) {
    throw new Error(
      `The eGov database "${source}" does not exist (set EGOV_DB_FILE or pass --db to use another path). Create it with: npm run db:import -- --file fixtures/live-all.json`,
    );
  }
  if (sameFile(from, to)) {
    throw new Error(`--out is the database being read ("${source}"). Pick a different file: this would overwrite it.`);
  }
  refuseToClobber(to);
  mkdirSync(dirname(to), { recursive: true });

  const building = `${to}.building`;
  const work = mkdtempSync(join(options.workDir ?? tmpdir(), "egov-site-"));
  try {
    // 1. A consistent snapshot, however busy the source is.
    const snapshot = join(work, "snapshot.db");
    const reader = new DatabaseSync(from, { readOnly: true });
    let schema: number;
    try {
      schema = userVersion(reader);
      if (schema !== MIGRATIONS.length) {
        throw new Error(
          schema === 0
            ? `"${source}" is not an eGov database (it has no schema).`
            : `"${source}" has schema version ${schema}; this checkout expects ${MIGRATIONS.length}. Run: npm run db:migrate`,
        );
      }
      reader.prepare("VACUUM INTO ?").run(snapshot);
    } finally {
      reader.close();
    }

    // 2. Delete everything the public views cannot show.
    const removed = { records: 0, admins: 0, numbering: 0 };
    const stripper = new DatabaseSync(snapshot);
    try {
      stripper.exec("BEGIN IMMEDIATE");
      removed.records = Number(
        stripper.prepare(`DELETE FROM records WHERE published <> 1 OR section NOT IN (${sectionList()})`).run().changes,
      );
      removed.admins = Number(stripper.prepare("DELETE FROM site_admins").run().changes);
      removed.numbering = Number(stripper.prepare("DELETE FROM numbering").run().changes);
      stripper.exec("COMMIT");

      // Mark it, so a deploy can refuse the database being edited (see above).
      stripper.exec(`PRAGMA application_id = ${PUBLIC_COPY_APPLICATION_ID}`);

      // 3. Rewrite the file, which is what actually removes the deleted rows' bytes.
      rmSync(building, { force: true });
      stripper.prepare("VACUUM INTO ?").run(building);
    } finally {
      stripper.close();
    }

    // 4. Only a copy that checks out replaces the last one.
    const { records, settings } = verify(building, schema);
    replaceFile(building, to);
    return { out: to, bytes: statSync(to).size, schema, records, settings, removed };
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(building, { force: true });
  }
}
