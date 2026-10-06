import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { MIGRATIONS } from "./db-schema.ts";
import {
  FIELDS,
  allocateSequence,
  importPayload,
  openDb,
  readPayload,
  readPayloadFromFile,
} from "./db.ts";
import { normalizePayload, normalizeRecord } from "./normalize.ts";
import { NUMBERED_SECTIONS, SECTIONS, type Section } from "./types.ts";

const live = JSON.parse(readFileSync("fixtures/live-all.json", "utf8"));

/** A payload with every section present, so tests only spell out what matters. */
function payload(overrides: Partial<Record<Section, object[]>> = {}, settings: object = {}) {
  const data: Record<string, unknown> = { SiteSettings: settings };
  for (const section of SECTIONS) data[section] = overrides[section] ?? [];
  return { ok: true, data };
}

function row(overrides: object) {
  return { id: "r1", title: "T", content: "body", published: true, ...overrides };
}

const open: DatabaseSync[] = [];
function memoryDb(): DatabaseSync {
  const db = openDb(":memory:");
  open.push(db);
  return db;
}
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

function sequences(db: DatabaseSync): Record<string, number> {
  const rows = db.prepare("SELECT section, year, last_sequence FROM numbering").all();
  return Object.fromEntries(rows.map((r) => [`${r.section}/${r.year}`, Number(r.last_sequence)]));
}

describe("schema", () => {
  it("is applied on open and recorded in user_version", () => {
    const db = memoryDb();
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, MIGRATIONS.length);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    assert.deepEqual(tables.map((t) => t.name), ["numbering", "records", "settings", "site_admins"]);
  });

  it("upgrades a database made before the admin whitelist, keeping its content", () => {
    const dir = mkdtempSync(join(tmpdir(), "egov-db-"));
    try {
      const file = join(dir, "egov.db");
      // The schema as it was when only migration 1 existed.
      const old = new DatabaseSync(file);
      old.exec(MIGRATIONS[0]!);
      old.exec("PRAGMA user_version = 1");
      old.exec("INSERT INTO records (section, id, title, content) VALUES ('Announcements', 'a', 'T', 'c')");
      old.close();

      const upgraded = openDb(file);
      open.push(upgraded);
      assert.equal(upgraded.prepare("PRAGMA user_version").get()!.user_version, MIGRATIONS.length);
      assert.equal(upgraded.prepare("SELECT count(*) AS n FROM records").get()!.n, 1);
      assert.equal(upgraded.prepare("SELECT count(*) AS n FROM site_admins").get()!.n, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps site admins through a replacing import, which only replaces the sheet's content", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO site_admins (citizenid, name) VALUES ('ABC12345', 'Mayor')").run();
    importPayload(db, payload({ Announcements: [row({})] }));
    importPayload(db, payload(), { replace: true });
    assert.equal(db.prepare("SELECT count(*) AS n FROM site_admins").get()!.n, 1);
  });

  it("accepts exactly the sections in types.ts", () => {
    const db = memoryDb();
    for (const section of SECTIONS) {
      db.prepare("INSERT INTO records (section, id, title, url) VALUES (?, 'x', 'x', 'https://x')").run(section);
    }
    assert.throws(
      () => db.prepare("INSERT INTO records (section, id, title) VALUES ('Nope', 'x', 'x')").run(),
      /section_is_known/,
    );
    const numbering = db.prepare("INSERT INTO numbering (section, year, last_sequence) VALUES (?, 2026, 1)");
    for (const section of NUMBERED_SECTIONS) numbering.run(section);
    assert.throws(() => numbering.run("Forms"), /section_is_numbered/);
  });

  it("stores every field the site reads", () => {
    const keys = new Set(FIELDS.map((f) => f.key));
    for (const key of Object.keys(normalizeRecord({}))) {
      assert.ok(keys.has(key), `EgovRecord.${key} has no column in the records table`);
    }
  });

  it("has a read-only view per section holding only that section", () => {
    const db = memoryDb();
    const views: Record<string, Section> = {
      forms: "Forms",
      announcements: "Announcements",
      executive_orders: "ExecutiveOrders",
      memorandums: "Memorandums",
      resolutions: "Resolutions",
    };
    importPayload(
      db,
      payload({
        Forms: [row({ id: "f", url: "https://forms.example" })],
        Announcements: [row({ id: "a" })],
        ExecutiveOrders: [row({ id: "e" })],
        Memorandums: [row({ id: "m1" }), row({ id: "m2" })],
        Resolutions: [row({ id: "r" })],
      }),
    );
    for (const [view, section] of Object.entries(views)) {
      const n = db.prepare(`SELECT count(*) AS n FROM ${view}`).get()!.n;
      assert.equal(n, section === "Memorandums" ? 2 : 1, view);
    }
    assert.throws(() => db.exec("DELETE FROM memorandums"), /view/i);
  });

  it("applies migrations once and reopens an existing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "egov-db-"));
    try {
      const file = join(dir, "nested", "egov.db");
      const first = openDb(file);
      importPayload(first, payload({ Announcements: [row({})] }));
      first.close();

      const again = openDb(file);
      assert.equal(again.prepare("SELECT count(*) AS n FROM records").get()!.n, 1);
      again.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
      again.close();
      assert.throws(() => openDb(file), /only knows up to/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("constraints", () => {
  const rejects = (overrides: Partial<Record<Section, object[]>>, message: RegExp) =>
    assert.throws(() => importPayload(memoryDb(), payload(overrides)), message);

  it("names the offending row", () => {
    rejects({ Announcements: [row({ id: "bad", date: "05/08/2026" })] }, /Announcements "bad": .*date_is_iso/);
    rejects({ Announcements: [row({ id: "bad", pinExpires: "soon" })] }, /pin_expires_is_iso/);
  });

  it("requires a title, and a link on forms", () => {
    rejects({ Announcements: [row({ title: "" })] }, /title_not_empty/);
    rejects({ Forms: [row({ url: "" })] }, /forms_have_a_link/);
  });

  it("refuses duplicate ids within a section but not across sections", () => {
    rejects({ Announcements: [row({}), row({})] }, /UNIQUE/);
    importPayload(memoryDb(), payload({ Announcements: [row({})], Resolutions: [row({})] }));
  });

  it("refuses two documents with the same stored number, but not printed duplicates", () => {
    const numbered = { publicationYear: 2026, publicationSequence: 3 };
    rejects({ Memorandums: [row({ id: "a", ...numbered }), row({ id: "b", ...numbered })] }, /UNIQUE/);
    // The live executive orders print "Blg. 09" twice and store no sequence.
    importPayload(
      memoryDb(),
      payload({ ExecutiveOrders: [row({ id: "a", number: "BLG.: 09" }), row({ id: "b", number: "BLG.: 09" })] }),
    );
  });

  it("is all-or-nothing", () => {
    const db = memoryDb();
    assert.throws(() =>
      importPayload(db, payload({ Announcements: [row({ id: "ok" }), row({ id: "bad", date: "x" })] })),
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM records").get()!.n, 0);
  });
});

describe("import and read", () => {
  it("builds the same site as the payload it was imported from", () => {
    const db = memoryDb();
    importPayload(db, live);
    assert.deepEqual(normalizePayload(readPayload(db)), normalizePayload(live));
  });

  it("returns what it was given, field for field", () => {
    const db = memoryDb();
    importPayload(db, live);
    const out = readPayload(db, { includeDrafts: true }).data;
    for (const section of SECTIONS) {
      // createdAt/updatedAt are blank-filled with the import time only when absent.
      assert.deepEqual(out[section], live.data[section], section);
    }
    assert.deepEqual(out.SiteSettings, live.data.SiteSettings);
  });

  it("keeps drafts but leaves them out of a build", () => {
    const db = memoryDb();
    importPayload(db, payload({ Announcements: [row({ id: "live" }), row({ id: "draft", published: false })] }));
    const ids = (p: ReturnType<typeof readPayload>) => (p.data.Announcements as { id: string }[]).map((r) => r.id);
    assert.deepEqual(ids(readPayload(db)), ["live"]);
    assert.deepEqual(ids(readPayload(db, { includeDrafts: true })).sort(), ["draft", "live"]);
  });

  it("orders like the sheet backend: admin order, then newest date", () => {
    const db = memoryDb();
    importPayload(
      db,
      payload({
        Announcements: [
          row({ id: "old", order: 0, date: "2026-01-01" }),
          row({ id: "new", order: 0, date: "2026-03-01" }),
          row({ id: "first", order: -1, date: "2025-01-01" }),
        ],
      }),
    );
    const ids = (readPayload(db).data.Announcements as { id: string }[]).map((r) => r.id);
    assert.deepEqual(ids, ["first", "new", "old"]);
  });

  it("stores pins, memorandum fields and settings", () => {
    const db = memoryDb();
    importPayload(
      db,
      payload(
        {
          Announcements: [row({ pinned: "TRUE", pinOrder: 2, pinExpires: "2026-12-31" })],
          Memorandums: [row({ subject: "S", memoTo: "A", memoFrom: "B", signatoryName: "N" })],
        },
        { siteTitle: "Test", mayorName: "" },
      ),
    );
    const data = normalizePayload(readPayload(db));
    assert.deepEqual(
      [data.sections.Announcements[0]!.pinned, data.sections.Announcements[0]!.pinOrder, data.sections.Announcements[0]!.pinExpires],
      [true, 2, "2026-12-31"],
    );
    const memo = data.sections.Memorandums[0]!;
    assert.deepEqual([memo.subject, memo.memoTo, memo.memoFrom, memo.signatoryName], ["S", "A", "B", "N"]);
    assert.equal(data.settings.siteTitle, "Test");
    // A blank setting still falls back to the default, as it does from the sheet.
    assert.equal(data.settings.mayorName, "Hon. Alejandro Tagalog");
  });

  it("skips rows without an id, like normalizePayload", () => {
    const db = memoryDb();
    const summary = importPayload(db, payload({ Announcements: [row({}), row({ id: "" })] }));
    assert.equal(summary.records.Announcements, 1);
  });

  it("refuses a payload with a section missing", () => {
    assert.throws(() => importPayload(memoryDb(), { ok: true, data: { Forms: [] } }), /missing the "Announcements"/);
    assert.throws(() => importPayload(memoryDb(), { ok: false, error: "Mali ang token" }), /Mali ang token/);
  });

  it("won't overwrite existing content unless told to, and then mirrors the payload", () => {
    const db = memoryDb();
    importPayload(db, payload({ Announcements: [row({ id: "a" }), row({ id: "b" })] }, { siteTitle: "Old" }));
    assert.throws(() => importPayload(db, payload()), /already has 3 rows/);

    importPayload(db, payload({ Announcements: [row({ id: "a" })] }, { siteTitle: "New" }), { replace: true });
    const data = normalizePayload(readPayload(db));
    assert.deepEqual(data.sections.Announcements.map((r) => r.id), ["a"]);
    assert.equal(data.settings.siteTitle, "New");
  });
});

describe("numbering", () => {
  it("is raised to the highest number already in use, stored or printed", () => {
    const db = memoryDb();
    importPayload(db, live);
    assert.deepEqual(sequences(db), {
      // Stored year and sequence.
      "Memorandums/2026": 11,
      "Resolutions/2026": 2,
      // Executive orders only have the printed "BLG.: 11 Serye ng 2026".
      "ExecutiveOrders/2026": 11,
    });
  });

  it("hands out the next number per section and year", () => {
    const db = memoryDb();
    assert.equal(allocateSequence(db, "Memorandums", 2026), 1);
    assert.equal(allocateSequence(db, "Memorandums", 2026), 2);
    assert.equal(allocateSequence(db, "Memorandums", 2027), 1);
    assert.equal(allocateSequence(db, "Resolutions", 2026), 1);
    assert.equal(allocateSequence(db, "Memorandums", 2026), 3);
  });

  it("continues after an import, and never goes backwards on a re-import", () => {
    const db = memoryDb();
    importPayload(db, payload({ Memorandums: [row({ publicationYear: 2026, publicationSequence: 7 })] }));
    assert.equal(allocateSequence(db, "Memorandums", 2026), 8);

    // The document holding number 8 was later deleted from the sheet.
    importPayload(db, payload({ Memorandums: [row({ publicationYear: 2026, publicationSequence: 7 })] }), {
      replace: true,
    });
    assert.equal(allocateSequence(db, "Memorandums", 2026), 9);
  });

  it("only numbers numbered sections", () => {
    const db = memoryDb();
    importPayload(db, payload({ Announcements: [row({ number: "Blg. 5, Serye ng 2026" })] }));
    assert.deepEqual(sequences(db), {});
    assert.throws(() => allocateSequence(db, "Announcements" as never, 2026), /section_is_numbered/);
  });
});

describe("reading for a build", () => {
  it("reads a database file", () => {
    const dir = mkdtempSync(join(tmpdir(), "egov-db-"));
    try {
      const file = join(dir, "egov.db");
      const db = openDb(file);
      importPayload(db, live);
      db.close();
      assert.deepEqual(normalizePayload(readPayloadFromFile(file)), normalizePayload(live));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails rather than invent an empty site from a missing or blank file", () => {
    const dir = mkdtempSync(join(tmpdir(), "egov-db-"));
    try {
      const missing = join(dir, "typo.db");
      assert.throws(() => readPayloadFromFile(missing), /does not exist/);

      const blank = join(dir, "blank.db");
      new DatabaseSync(blank).close();
      assert.throws(() => readPayloadFromFile(blank), /not an eGov database/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
