import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncement,
  listAnnouncements,
  updateAnnouncement,
} from "./announcements.ts";
import { importPayload, openDb, readPayload } from "./db.ts";
import { orderedAnnouncements } from "./documents.ts";
import { normalizePayload } from "./normalize.ts";
import { SECTIONS, type Section } from "./types.ts";

const live = JSON.parse(readFileSync("fixtures/live-all.json", "utf8"));

const open: DatabaseSync[] = [];
function memoryDb(): DatabaseSync {
  const db = openDb(":memory:");
  open.push(db);
  return db;
}
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

/** A payload with every section present, so tests only spell out what matters. */
function payload(overrides: Partial<Record<Section, object[]>> = {}) {
  const data: Record<string, unknown> = { SiteSettings: {} };
  for (const section of SECTIONS) data[section] = overrides[section] ?? [];
  return { ok: true, data };
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);

function stored(db: DatabaseSync, section: Section, id: string) {
  return db.prepare("SELECT * FROM records WHERE section = ? AND id = ?").get(section, id);
}

describe("createAnnouncement", () => {
  it("stores a draft with the backend's defaults, and returns it as stored", () => {
    const db = memoryDb();
    const created = createAnnouncement(db, { title: "  Bagong Anunsyo  ", content: "Laman" });

    assert.match(created.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(created.title, "Bagong Anunsyo");
    assert.equal(created.content, "Laman");
    assert.equal(created.published, false);
    assert.equal(created.pinned, false);
    assert.equal(created.pinOrder, 1);
    assert.equal(created.order, 0);
    assert.equal(created.date, "");
    assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(created.updatedAt, created.createdAt);
    assert.deepEqual(getAnnouncement(db, created.id), created);
  });

  it("keeps every field it is given", () => {
    const db = memoryDb();
    const created = createAnnouncement(db, {
      id: "a1",
      title: "T",
      description: "D",
      number: "Blg. 5",
      date: "2026-08-22",
      url: "https://example.com/a",
      image: "https://example.com/a.png",
      icon: "📣",
      order: 2,
      published: true,
      content: "C",
      pinned: true,
      pinOrder: 3,
      pinExpires: "2026-12-31",
    });
    assert.deepEqual(
      { ...created, createdAt: "", updatedAt: "" },
      {
        id: "a1",
        title: "T",
        description: "D",
        number: "Blg. 5",
        date: "2026-08-22",
        url: "https://example.com/a",
        image: "https://example.com/a.png",
        icon: "📣",
        order: 2,
        published: true,
        content: "C",
        publicationYear: 0,
        publicationSequence: 0,
        publishedAt: "",
        pinned: true,
        pinOrder: 3,
        pinExpires: "2026-12-31",
        subject: "",
        memoTo: "",
        memoFrom: "",
        signatureImage: "",
        signatoryName: "",
        signatoryPosition: "",
        createdAt: "",
        updatedAt: "",
      },
    );
  });

  it("refuses an id that is taken, but not one used in another section", () => {
    const db = memoryDb();
    importPayload(db, payload({ Resolutions: [{ id: "same", title: "R", content: "c" }] }));

    createAnnouncement(db, { id: "same", title: "A", content: "c" });
    assert.throws(() => createAnnouncement(db, { id: "same", title: "B", content: "c" }), /"same" already exists/);
    assert.equal(getAnnouncement(db, "same")!.title, "A");
    assert.equal(stored(db, "Resolutions", "same")!.title, "R");
  });

  it("refuses what the sheet backend refuses", () => {
    const db = memoryDb();
    const refuses = (input: Parameters<typeof createAnnouncement>[1], message: RegExp) =>
      assert.throws(() => createAnnouncement(db, input), message);

    refuses({ title: "   ", content: "c" }, /A title is required/);
    refuses({ title: "T" }, /full content or an external link/);
    refuses({ title: "T", content: "  ", url: " " }, /full content or an external link/);
    refuses({ title: "T", content: "x".repeat(45001) }, /limited to 45,000 characters/);
    createAnnouncement(db, { title: "T", content: "x".repeat(45000) });
    createAnnouncement(db, { title: "T", url: "https://example.com" });

    assert.equal(listAnnouncements(db, { includeDrafts: true }).length, 2);
  });

  it("checks dates and pins before the database does", () => {
    const db = memoryDb();
    const base = { title: "T", content: "c" };
    assert.throws(() => createAnnouncement(db, { ...base, date: "05/08/2026" }), /The date must look like/);
    assert.throws(() => createAnnouncement(db, { ...base, pinExpires: "soon" }), /last day of the pin must look like/);
    for (const pinOrder of [0, 4, 1.5]) {
      assert.throws(() => createAnnouncement(db, { ...base, pinned: true, pinOrder }), /pin order must be a whole number from 1 to 3/);
    }
    // The order only matters while pinned.
    createAnnouncement(db, { ...base, pinned: false, pinOrder: 0 });
    createAnnouncement(db, { ...base, pinned: true, pinOrder: 3 });
    assert.equal(listAnnouncements(db, { includeDrafts: true }).length, 2);
  });
});

describe("getAnnouncement and listAnnouncements", () => {
  it("finds an announcement by id, only within Announcements", () => {
    const db = memoryDb();
    importPayload(db, payload({ Resolutions: [{ id: "r", title: "R", content: "c" }] }));
    createAnnouncement(db, { id: "a", title: "A", content: "c" });

    assert.equal(getAnnouncement(db, "a")!.title, "A");
    assert.equal(getAnnouncement(db, "r"), undefined);
    assert.equal(getAnnouncement(db, "missing"), undefined);
  });

  it("lists only announcements, leaving drafts out unless asked", () => {
    const db = memoryDb();
    importPayload(db, payload({ Resolutions: [{ id: "r", title: "R", content: "c", published: true }] }));
    createAnnouncement(db, { id: "live", title: "T", content: "c", published: true });
    createAnnouncement(db, { id: "draft", title: "T", content: "c" });

    assert.deepEqual(ids(listAnnouncements(db)), ["live"]);
    assert.deepEqual(ids(listAnnouncements(db, { includeDrafts: true })).sort(), ["draft", "live"]);
  });

  it("orders like the backend: admin order, newest date, then entry order", () => {
    const db = memoryDb();
    const make = (id: string, order: number, date: string) =>
      createAnnouncement(db, { id, title: id, content: "c", published: true, order, date });
    make("old", 0, "2026-01-01");
    make("new", 0, "2026-03-01");
    make("first", -1, "2025-01-01");
    make("tie-a", 5, "2026-01-01");
    make("tie-b", 5, "2026-01-01");

    assert.deepEqual(ids(listAnnouncements(db)), ["first", "new", "old", "tie-a", "tie-b"]);
    assert.deepEqual(ids(listAnnouncements(db)), ids(readPayload(db).data.Announcements as { id: string }[]));
  });

  it("hands pins to orderedAnnouncements() as the site does", () => {
    const db = memoryDb();
    createAnnouncement(db, { id: "plain", title: "T", content: "c", published: true, date: "2026-09-01" });
    createAnnouncement(db, { id: "pin", title: "T", content: "c", published: true, date: "2026-01-01", pinned: true });
    createAnnouncement(db, { id: "lapsed", title: "T", content: "c", published: true, pinned: true, pinExpires: "2026-02-01" });

    const ordered = orderedAnnouncements(listAnnouncements(db), "2026-10-06");
    assert.deepEqual(
      ordered.map((o) => [o.item.id, o.pinned]),
      [["pin", true], ["plain", false], ["lapsed", false]],
    );
  });
});

describe("updateAnnouncement", () => {
  /** Backdates the row so a later updatedAt is visibly newer. */
  function makeOld(db: DatabaseSync, id: string) {
    db.prepare("UPDATE records SET created_at = '2020-01-01T00:00:00.000Z', updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id);
  }

  it("changes only the fields it is given", () => {
    const db = memoryDb();
    const before = createAnnouncement(db, {
      id: "a",
      title: "Old",
      description: "D",
      content: "C",
      date: "2026-05-01",
      published: true,
      order: 4,
    });

    const after = updateAnnouncement(db, "a", { title: "  New  ", pinned: true, pinOrder: 2, published: undefined });

    assert.deepEqual(after, { ...before, title: "New", pinned: true, pinOrder: 2, updatedAt: after.updatedAt });
    assert.deepEqual(getAnnouncement(db, "a"), after);
  });

  it("keeps createdAt and moves updatedAt", () => {
    const db = memoryDb();
    createAnnouncement(db, { id: "a", title: "T", content: "c" });
    makeOld(db, "a");

    const after = updateAnnouncement(db, "a", { published: true });
    assert.equal(after.createdAt, "2020-01-01T00:00:00.000Z");
    assert.ok(after.updatedAt > "2020-01-01T00:00:00.000Z");
    assert.equal(after.published, true);
  });

  it("can clear optional fields, including a pin", () => {
    const db = memoryDb();
    createAnnouncement(db, { id: "a", title: "T", content: "c", url: "https://x", pinned: true, pinExpires: "2026-12-31", date: "2026-01-01" });

    const after = updateAnnouncement(db, "a", { url: "", pinned: false, pinExpires: "", date: "" });
    assert.deepEqual([after.url, after.pinned, after.pinExpires, after.date], ["", false, "", ""]);
  });

  it("checks the record as a whole and leaves it untouched when refused", () => {
    const db = memoryDb();
    const before = createAnnouncement(db, { id: "a", title: "T", content: "only content", published: true });

    assert.throws(() => updateAnnouncement(db, "a", { content: "" }), /full content or an external link/);
    assert.throws(() => updateAnnouncement(db, "a", { title: " " }), /A title is required/);
    assert.throws(() => updateAnnouncement(db, "a", { title: "Changed", pinned: true, pinOrder: 9 }), /pin order/);
    assert.throws(() => updateAnnouncement(db, "a", { date: "yesterday" }), /The date must look like/);

    assert.deepEqual(getAnnouncement(db, "a"), before);
    // Giving it a link first makes clearing the content fine.
    assert.equal(updateAnnouncement(db, "a", { url: "https://x", content: "" }).content, "");
  });

  it("doesn't touch other sections, or columns announcements don't expose", () => {
    const db = memoryDb();
    importPayload(
      db,
      payload({
        Announcements: [{ id: "same", title: "A", content: "c", subject: "Sheet filled this" }],
        Resolutions: [{ id: "same", title: "R", content: "c" }],
      }),
    );

    updateAnnouncement(db, "same", { title: "A2" });

    assert.equal(stored(db, "Announcements", "same")!.title, "A2");
    assert.equal(stored(db, "Announcements", "same")!.subject, "Sheet filled this");
    assert.equal(stored(db, "Resolutions", "same")!.title, "R");
  });

  it("ignores fields that aren't editable, such as the id", () => {
    const db = memoryDb();
    createAnnouncement(db, { id: "a", title: "T", content: "c" });
    const sneaky = { id: "b", createdAt: "1999-01-01", section: "Forms", title: "T2" } as never;

    const after = updateAnnouncement(db, "a", sneaky);
    assert.deepEqual([after.id, after.title, after.createdAt === "1999-01-01"], ["a", "T2", false]);
    assert.equal(getAnnouncement(db, "b"), undefined);
  });

  it("refuses an announcement that doesn't exist", () => {
    const db = memoryDb();
    importPayload(db, payload({ Resolutions: [{ id: "r", title: "R", content: "c" }] }));
    assert.throws(() => updateAnnouncement(db, "missing", { title: "T" }), /"missing" was not found/);
    assert.throws(() => updateAnnouncement(db, "r", { title: "T" }), /"r" was not found/);
    assert.equal(stored(db, "Resolutions", "r")!.title, "R");
  });
});

describe("deleteAnnouncement", () => {
  it("removes the announcement, and only that one", () => {
    const db = memoryDb();
    importPayload(db, payload({ Resolutions: [{ id: "a", title: "R", content: "c" }] }));
    createAnnouncement(db, { id: "a", title: "A", content: "c" });
    createAnnouncement(db, { id: "b", title: "B", content: "c" });

    deleteAnnouncement(db, "a");

    assert.deepEqual(ids(listAnnouncements(db, { includeDrafts: true })), ["b"]);
    assert.equal(stored(db, "Resolutions", "a")!.title, "R");
    // The id is free again.
    createAnnouncement(db, { id: "a", title: "A again", content: "c" });
  });

  it("refuses an announcement that doesn't exist", () => {
    const db = memoryDb();
    importPayload(db, payload({ Resolutions: [{ id: "r", title: "R", content: "c" }] }));
    assert.throws(() => deleteAnnouncement(db, "missing"), /"missing" was not found/);
    assert.throws(() => deleteAnnouncement(db, "r"), /"r" was not found/);
    assert.equal(stored(db, "Resolutions", "r")!.title, "R");
  });
});

describe("with the live data", () => {
  it("reads what was imported, and a change reaches the built site", () => {
    const db = memoryDb();
    importPayload(db, live);

    const all = listAnnouncements(db, { includeDrafts: true });
    assert.deepEqual(ids(all), ids(live.data.Announcements));

    const created = createAnnouncement(db, { title: "Bago", content: "c", published: true, date: "2026-10-01" });
    const built = normalizePayload(readPayload(db)).sections.Announcements;
    assert.ok(ids(built).includes(created.id));

    updateAnnouncement(db, created.id, { published: false });
    assert.ok(!ids(normalizePayload(readPayload(db)).sections.Announcements).includes(created.id));

    deleteAnnouncement(db, created.id);
    assert.deepEqual(ids(listAnnouncements(db, { includeDrafts: true })), ids(live.data.Announcements));
  });
});
