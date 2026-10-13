import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { addAdmin } from "./admins.ts";
import { MIGRATIONS } from "./db-schema.ts";
import { importPayload, openDb } from "./db.ts";
import { normalizePayload } from "./normalize.ts";
import { PUBLIC_COPY_APPLICATION_ID, buildPublicDatabase } from "./public-db.ts";
import { DOCUMENT_SECTIONS, SECTIONS, type Section } from "./types.ts";

const live = JSON.parse(readFileSync("fixtures/live-all.json", "utf8"));

// Text that must never reach a server: if it turns up in a built file, the
// build leaked something.
const PRIVATE = {
  draftTitle: "ZZ-DRAFT-TITLE-7731",
  draftContent: "ZZ-DRAFT-BODY-4410",
  formTitle: "ZZ-FORM-TITLE-9921",
  adminId: "ZZADMIN4242",
  adminName: "Zz Secret Admin Name",
};

// The columns the phone app reads, in order (EgovRecord in the phone's
// web/src/apps/egov/types.ts, plus `section`).
const RECORD_COLUMNS = [
  "section", "id", "title", "description", "number", "date", "createdAt", "content", "image",
  "memoTo", "memoFrom", "subject", "pinned", "pinOrder", "pinExpires",
];

const open: DatabaseSync[] = [];
const dirs: string[] = [];
function track(db: DatabaseSync): DatabaseSync {
  open.push(db);
  return db;
}
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "egov-pub-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  // Windows won't delete a folder with an open database in it.
  for (const db of open.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function payload(overrides: Partial<Record<Section, object[]>> = {}, settings: object = {}) {
  const data: Record<string, unknown> = { SiteSettings: settings };
  for (const section of SECTIONS) data[section] = overrides[section] ?? [];
  return { ok: true, data };
}
const row = (overrides: object) => ({ id: "r1", title: "T", content: "body", published: true, ...overrides });

/** Fills a database with published documents, and with everything private. */
function seed(db: DatabaseSync): void {
  importPayload(
    db,
    payload(
      {
        ExecutiveOrders: [
          row({ id: "eo1", title: "Published EO", number: "Executive Order Blg. 01, Serye ng 2026", date: "2026-01-02" }),
          row({ id: "eo-draft", title: PRIVATE.draftTitle, content: PRIVATE.draftContent, published: false }),
        ],
        Resolutions: [row({ id: "res1", title: "Published Resolution" })],
        Memorandums: [row({ id: "memo1", title: "Memo", subject: "Subj", memoTo: "All", memoFrom: "Mayor", content: "" })],
        Announcements: [
          row({ id: "ann1", title: "News", content: "Has text", image: "https://img.example/a.png", pinned: true, pinOrder: 2, pinExpires: "2026-12-31" }),
          row({ id: "ann-blank", title: "Welcome", content: "" }),
          row({ id: "ann-draft", title: "Draft news", content: PRIVATE.draftContent, published: false }),
        ],
        Forms: [row({ id: "form1", title: PRIVATE.formTitle, url: "https://forms.example/x" })],
      },
      { mayorName: "Kgg. Test Mayor", mayorImageUrl: "https://img.example/mayor.png", meetingUrl: "https://meet.example", footerText: "footer" },
    ),
  );
  // Whitespace the importer would trim away, as a database edited by hand can hold.
  db.prepare("INSERT INTO records (section, id, title, content, published) VALUES ('Announcements', 'ann-space', 'Whitespace', ?, 1)")
    .run(" \n\t\r\n ");
  addAdmin(db, PRIVATE.adminId, PRIVATE.adminName);
}

/** An authoring database on disk, closed again so the build can have it to itself. */
function source(dir = tempDir()): string {
  const file = join(dir, "egov.db");
  const db = openDb(file);
  try {
    seed(db);
  } finally {
    db.close();
  }
  return file;
}

const readOnly = (file: string) => track(new DatabaseSync(file, { readOnly: true }));
const all = (db: DatabaseSync, sql: string) => db.prepare(sql).all().map((r) => ({ ...r }));
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

describe("the public views", () => {
  const seeded = () => {
    const db = track(openDb(":memory:"));
    seed(db);
    return db;
  };

  it("expose exactly the columns the phone app reads, in order", () => {
    const db = track(openDb(":memory:"));
    const names = (view: string) => db.prepare(`PRAGMA table_info(${view})`).all().map((c) => c.name);
    assert.deepEqual(names("public_records"), RECORD_COLUMNS);
    assert.deepEqual(names("public_settings"), ["key", "value"]);
  });

  it("hold the published documents and nothing else", () => {
    const rows = all(seeded(), "SELECT section, id FROM public_records ORDER BY section, id");
    assert.deepEqual(rows, [
      { section: "Announcements", id: "ann1" },
      { section: "ExecutiveOrders", id: "eo1" },
      { section: "Memorandums", id: "memo1" }, // no body text, but a memorandum has its subject
      { section: "Resolutions", id: "res1" },
    ]);
  });

  it("leave out an announcement with nothing to read, however it is blank", () => {
    const ids = all(seeded(), "SELECT id FROM public_records WHERE section = 'Announcements'").map((r) => r.id);
    assert.ok(!ids.includes("ann-blank"), "an empty announcement is a dead card");
    assert.ok(!ids.includes("ann-space"), "so is one holding only spaces, tabs and newlines");
  });

  it("carry every field under the app's names", () => {
    const db = seeded();
    const ann = all(db, "SELECT * FROM public_records WHERE id = 'ann1'")[0]!;
    assert.match(String(ann.createdAt), /^\d{4}-\d\d-\d\dT/);
    assert.equal(ann.content, "Has text");
    assert.equal(ann.image, "https://img.example/a.png");
    assert.deepEqual([ann.pinned, ann.pinOrder, ann.pinExpires], [1, 2, "2026-12-31"]);
    const memo = all(db, "SELECT * FROM public_records WHERE id = 'memo1'")[0]!;
    assert.deepEqual([memo.memoTo, memo.memoFrom, memo.subject], ["All", "Mayor", "Subj"]);
    const eo = all(db, "SELECT * FROM public_records WHERE id = 'eo1'")[0]!;
    assert.deepEqual([eo.number, eo.date], ["Executive Order Blg. 01, Serye ng 2026", "2026-01-02"]);
  });

  it("match what the site shows, record for record, on the live data", () => {
    const db = track(openDb(":memory:"));
    importPayload(db, live);
    const site = normalizePayload(live).sections;
    for (const section of DOCUMENT_SECTIONS) {
      const shown = site[section].filter((r) => section !== "Announcements" || r.content.trim() !== "");
      const rows = all(db, `SELECT * FROM public_records WHERE section = '${section}' ORDER BY id`);
      assert.deepEqual(rows.map((r) => r.id), shown.map((r) => r.id).sort(), section);
      for (const record of shown) {
        const got = rows.find((r) => r.id === record.id)!;
        const picture = /^https?:\/\//i.test(record.image) ? record.image : "";
        assert.deepEqual(
          [got.title, got.description, got.number, got.date, got.content, got.image, got.memoTo, got.memoFrom, got.subject, Boolean(got.pinned), got.pinOrder, got.pinExpires],
          [record.title, record.description, record.number, record.date, record.content, picture, record.memoTo, record.memoFrom, record.subject, record.pinned, record.pinOrder, record.pinExpires],
          `${section} ${record.id}`,
        );
      }
    }
    assert.ok(all(db, "SELECT id FROM public_records").length > 20, "the live data should fill the view");
  });

  it("show a picture only if it is an http(s) address", () => {
    const db = seeded();
    const picture = (value: string) => {
      db.prepare("UPDATE records SET image = ? WHERE id = 'ann1'").run(value);
      return all(db, "SELECT image FROM public_records WHERE id = 'ann1'")[0]!.image;
    };
    for (const ok of ["https://img.example/a.png", "http://img.example/a.png", "HTTPS://IMG.EXAMPLE/A.PNG"]) {
      assert.equal(picture(ok), ok);
    }
    for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "file:///c:/x.png", "/relative.png", "//host/x.png", " https://x.example/a.png", "httpx://x", ""]) {
      assert.equal(picture(bad), "", `"${bad}" must not reach the app`);
    }
  });

  it("share the mayor from the settings and no other setting", () => {
    const rows = all(seeded(), "SELECT key, value FROM public_settings ORDER BY key");
    assert.deepEqual(rows, [
      { key: "mayorImageUrl", value: "https://img.example/mayor.png" },
      { key: "mayorName", value: "Kgg. Test Mayor" },
    ]);

    const db = seeded();
    db.prepare("UPDATE settings SET value = 'javascript:alert(1)' WHERE key = 'mayorImageUrl'").run();
    assert.equal(all(db, "SELECT value FROM public_settings WHERE key = 'mayorImageUrl'")[0]!.value, "");
  });

  it("name the same sections as the build deletes by", () => {
    const listed = /section IN \(([^)]*)\)/.exec(MIGRATIONS[2]!)![1]!
      .split(",")
      .map((s) => s.trim().replace(/'/g, ""))
      .sort();
    assert.deepEqual(listed, [...DOCUMENT_SECTIONS].sort());
  });
});

describe("the public copy", () => {
  it("answers the public views exactly as the database it came from does", () => {
    const from = source();
    const out = join(tempDir(), "site.db");
    buildPublicDatabase(from, out);

    const original = readOnly(from);
    const built = readOnly(out);
    for (const sql of [
      "SELECT * FROM public_records ORDER BY section, id",
      "SELECT * FROM public_settings ORDER BY key",
    ]) {
      assert.deepEqual(all(built, sql), all(original, sql), sql);
    }
    assert.equal(built.prepare("PRAGMA user_version").get()!.user_version, MIGRATIONS.length);
    assert.equal(built.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
  });

  it("is marked in its file header, which the database being edited is not", () => {
    const from = source();
    const out = join(tempDir(), "site.db");
    buildPublicDatabase(from, out);

    // SQLite's application_id: 4 bytes, big-endian, at offset 68. A deploy script reads it
    // without opening the file, to refuse shipping the database that holds the drafts.
    assert.equal(readFileSync(out).readUInt32BE(68), PUBLIC_COPY_APPLICATION_ID);
    assert.equal(readFileSync(from).readUInt32BE(68), 0);
    assert.equal(readFileSync(out).subarray(68, 72).toString("latin1"), "PUBD");
  });

  it("has no drafts, forms, admins or numbering", () => {
    const out = join(tempDir(), "site.db");
    buildPublicDatabase(source(), out);
    const built = readOnly(out);
    const n = (sql: string) => Number(built.prepare(sql).get()!.n);

    assert.equal(n("SELECT count(*) AS n FROM records WHERE published <> 1"), 0);
    assert.equal(n("SELECT count(*) AS n FROM records WHERE section = 'Forms'"), 0);
    assert.equal(n("SELECT count(*) AS n FROM site_admins"), 0);
    assert.equal(n("SELECT count(*) AS n FROM numbering"), 0);
    assert.ok(n("SELECT count(*) AS n FROM records") > 0, "the published records are still there");
  });

  it("contains none of the private text, not even in the free pages of the file", () => {
    const from = source();
    const out = join(tempDir(), "site.db");
    const work = tempDir();
    buildPublicDatabase(from, out, { workDir: work });

    // The control: every marker really is in the database that was read.
    const before = readFileSync(from);
    for (const [name, text] of Object.entries(PRIVATE)) {
      assert.ok(before.includes(text), `${name} should be in the source, or this test proves nothing`);
    }

    // And deleting the rows is NOT enough on its own, which is why the build rewrites the file.
    const deletedOnly = join(tempDir(), "deleted-only.db");
    const reader = readOnly(from);
    reader.prepare("VACUUM INTO ?").run(deletedOnly);
    const copy = new DatabaseSync(deletedOnly);
    copy.exec("DELETE FROM records WHERE published <> 1; DELETE FROM site_admins");
    copy.close();
    assert.ok(readFileSync(deletedOnly).includes(PRIVATE.draftTitle), "deleted rows linger until the file is rewritten");

    const after = readFileSync(out);
    for (const [name, text] of Object.entries(PRIVATE)) {
      assert.ok(!after.includes(text), `${name} ("${text}") is in the built file`);
    }
    assert.deepEqual(readdirSync(work), [], "the intermediate copy, which holds the private rows, is removed");
  });

  it("reports what it did, in counts only", () => {
    const from = source();
    const built = buildPublicDatabase(from, join(tempDir(), "site.db"));

    assert.deepEqual(built.records, { Announcements: 1, ExecutiveOrders: 1, Memorandums: 1, Resolutions: 1 });
    assert.equal(built.settings, 2);
    assert.equal(built.schema, MIGRATIONS.length);
    // Two drafts and the form. The two blank announcements are published, so they
    // stay in the table; the public view is what hides them.
    assert.equal(built.removed.records, 3);
    assert.equal(built.removed.admins, 1);
    const sourceDb = readOnly(from);
    assert.equal(built.removed.numbering, Number(sourceDb.prepare("SELECT count(*) AS n FROM numbering").get()!.n));
    assert.ok(built.bytes > 0);
    assert.doesNotMatch(JSON.stringify(built), new RegExp(PRIVATE.adminId));
  });

  it("replaces an earlier build, picks up edits, and leaves nothing else behind", () => {
    const dir = tempDir();
    const from = source();
    const out = join(dir, "out", "site.db");
    buildPublicDatabase(from, out);

    const edit = new DatabaseSync(from);
    edit.prepare("INSERT INTO records (section, id, title, content, published) VALUES ('Announcements', 'late', 'Late news', 'text', 1)").run();
    edit.close();
    const second = buildPublicDatabase(from, out);

    assert.equal(second.records.Announcements, 2);
    assert.deepEqual(readdirSync(join(dir, "out")), ["site.db"]);
  });

  it("only reads its source, so it is safe while the dashboard has it open", () => {
    const from = source();
    const dashboard = track(openDb(from)); // held open, as the dashboard holds it
    const before = hash(from);
    buildPublicDatabase(from, join(tempDir(), "site.db"));

    assert.equal(hash(from), before, "the source database was changed");
    assert.ok(Number(dashboard.prepare("SELECT count(*) AS n FROM records").get()!.n) > 0, "the dashboard's connection still works");
  });

  it("will not write over the database it is reading", () => {
    const from = source();
    const before = hash(from);
    for (const alias of process.platform === "win32" ? [from, from.toUpperCase(), from.replace(/\\/g, "/")] : [from]) {
      assert.throws(() => buildPublicDatabase(from, alias), /overwrite it/);
    }
    assert.equal(hash(from), before);
    const db = track(openDb(from));
    assert.ok(Number(db.prepare("SELECT count(*) AS n FROM site_admins").get()!.n) === 1, "the source still has its admins");
  });

  it("will not write over a file that is not a database, or a folder", () => {
    const dir = tempDir();
    const notes = join(dir, "notes.txt");
    writeFileSync(notes, "my notes, not a database");
    assert.throws(() => buildPublicDatabase(source(), notes), /not a SQLite database/);
    assert.equal(readFileSync(notes, "utf8"), "my notes, not a database");

    mkdirSync(join(dir, "folder"));
    assert.throws(() => buildPublicDatabase(source(), join(dir, "folder")), /not a file/);

    // An empty placeholder file is fine to replace.
    const empty = join(dir, "empty.db");
    writeFileSync(empty, "");
    assert.doesNotThrow(() => buildPublicDatabase(source(), empty));
  });

  it("refuses a source that is missing, not a database, or has not had migration 3, leaving the last build alone", () => {
    const dir = tempDir();
    const out = join(dir, "site.db");
    buildPublicDatabase(source(), out);
    const good = hash(out);

    const old = join(dir, "old.db");
    const legacy = new DatabaseSync(old);
    legacy.exec(MIGRATIONS[0]!);
    legacy.exec(MIGRATIONS[1]!);
    legacy.exec("PRAGMA user_version = 2");
    legacy.close();
    assert.throws(() => buildPublicDatabase(old, out), /schema version 2.*db:migrate/);

    assert.throws(() => buildPublicDatabase(join(dir, "missing.db"), out), /does not exist/);
    const junk = join(dir, "junk.db");
    writeFileSync(junk, "this is not a database file at all, just text");
    assert.throws(() => buildPublicDatabase(junk, out));

    assert.equal(hash(out), good, "a failed build must leave the last good file untouched");
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".building")), []);
  });
});

describe("npm run site:build", () => {
  const run = (...args: string[]) => {
    try {
      const stdout = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/site-build.mjs", ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const e = error as { status: number; stdout: string; stderr: string };
      return { status: e.status, stdout: e.stdout, stderr: e.stderr };
    }
  };

  it("builds and says what it left out", () => {
    const out = join(tempDir(), "site.db");
    const result = run("--db", source(), "--out", out);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Built .*site\.db/);
    assert.match(result.stdout, /Announcements 1, ExecutiveOrders 1, Memorandums 1, Resolutions 1/);
    assert.match(result.stdout, /left out: 3 records .*1 admins/);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(`${PRIVATE.adminId}|${PRIVATE.draftTitle}`));
    assert.ok(existsSync(out));
  });

  it("says how to use it, and why it stopped", () => {
    const usage = run();
    assert.equal(usage.status, 1);
    assert.match(usage.stderr, /--out/);

    const same = source();
    const refused = run("--db", same, "--out", same);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /overwrite it/);
    assert.equal(basename(same), "egov.db");
  });
});
