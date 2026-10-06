import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import type { DatabaseSync } from "node:sqlite";

import { importPayload, openDb, readPayload } from "./db.ts";
import { documentSequence, documentYear } from "./documents.ts";
import { normalizePayload } from "./normalize.ts";
import {
  createRecord,
  deleteRecord,
  formatNumber,
  getRecord,
  listRecords,
  parseSection,
  updateRecord,
} from "./records.ts";
import { SECTIONS, type Section } from "./types.ts";
import { AdminError, isIsoDate, isWebUrl } from "./validation.ts";

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

function payload(overrides: Partial<Record<Section, object[]>> = {}) {
  const data: Record<string, unknown> = { SiteSettings: {} };
  for (const section of SECTIONS) data[section] = overrides[section] ?? [];
  return { ok: true, data };
}

function stored(db: DatabaseSync, section: Section, id: string) {
  return db.prepare("SELECT * FROM records WHERE section = ? AND id = ?").get(section, id);
}

function counter(db: DatabaseSync, section: string, year: number) {
  const row = db.prepare("SELECT last_sequence FROM numbering WHERE section = ? AND year = ?").get(section, year);
  return row ? Number(row.last_sequence) : 0;
}

/** Runs `work` and returns the AdminError it throws, failing if it throws anything else or nothing. */
function refused(work: () => unknown): AdminError {
  try {
    work();
  } catch (error) {
    assert.ok(error instanceof AdminError, `expected an AdminError, got ${String(error)}`);
    return error;
  }
  assert.fail("expected the change to be refused");
}

const order = { title: "Order", content: "Body", date: "2026-03-01", published: true };

describe("createRecord", () => {
  it("stores a draft with the backend's defaults, and returns it as stored", () => {
    const db = memoryDb();
    const created = createRecord(db, "Announcements", { title: "  Bagong Anunsyo  ", content: "Laman" });

    assert.match(created.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(created.title, "Bagong Anunsyo");
    assert.equal(created.published, false);
    assert.equal(created.pinned, false);
    assert.equal(created.pinOrder, 1);
    assert.equal(created.order, 0);
    assert.equal(created.autoNumber, false);
    assert.equal(created.updatedAt, created.createdAt);
    assert.deepEqual(getRecord(db, "Announcements", created.id), created);
  });

  it("keeps every field a section uses", () => {
    const db = memoryDb();
    const created = createRecord(db, "Memorandums", {
      id: "m1",
      subject: "Paksa",
      memoTo: "Hepe",
      memoFrom: "Alkalde",
      description: "D",
      number: "Blg. 5",
      date: "2026-08-22",
      url: "https://example.com/a",
      image: "https://example.com/a.png",
      icon: "📣",
      order: 2,
      content: "C",
      signatureImage: "https://example.com/sign.png",
      signatoryName: "Name",
      signatoryPosition: "Position",
      autoNumber: false,
    });
    assert.deepEqual(
      { ...created, createdAt: "", updatedAt: "" },
      {
        id: "m1",
        title: "Paksa",
        description: "D",
        number: "Blg. 5",
        date: "2026-08-22",
        url: "https://example.com/a",
        image: "https://example.com/a.png",
        icon: "📣",
        order: 2,
        published: false,
        content: "C",
        publicationYear: 0,
        publicationSequence: 0,
        publishedAt: "",
        pinned: false,
        pinOrder: 1,
        pinExpires: "",
        subject: "Paksa",
        memoTo: "Hepe",
        memoFrom: "Alkalde",
        signatureImage: "https://example.com/sign.png",
        signatoryName: "Name",
        signatoryPosition: "Position",
        autoNumber: false,
        createdAt: "",
        updatedAt: "",
      },
    );
  });

  it("takes strings and numbers from JSON as the right types", () => {
    const db = memoryDb();
    const created = createRecord(db, "Forms", {
      title: "F",
      url: "https://example.com/f",
      order: "3" as unknown as number,
      published: "true" as unknown as boolean,
    });
    assert.equal(created.order, 3);
    assert.equal(created.published, true);
  });

  it("refuses an id that is taken, but not one used in another section", () => {
    const db = memoryDb();
    importPayload(db, payload({ Resolutions: [{ id: "same", title: "R", content: "c" }] }));

    createRecord(db, "Announcements", { id: "same", title: "A", content: "c" });
    const error = refused(() => createRecord(db, "Announcements", { id: "same", title: "B", content: "c" }));
    assert.equal(error.code, "idTaken");
    assert.equal(error.status, 409);
    assert.equal(getRecord(db, "Announcements", "same")!.title, "A");
    assert.equal(stored(db, "Resolutions", "same")!.title, "R");
  });

  it("only writes the fields a section uses", () => {
    const db = memoryDb();
    const form = createRecord(db, "Forms", {
      title: "F",
      url: "https://example.com/f",
      pinned: true,
      subject: "ignored",
      number: "ignored",
    });
    assert.equal(form.pinned, false);
    assert.equal(form.subject, "");
    assert.equal(form.number, "");

    const announcement = createRecord(db, "Announcements", { title: "A", content: "c", autoNumber: true, memoTo: "x" });
    assert.equal(announcement.autoNumber, false);
    assert.equal(announcement.memoTo, "");
  });
});

describe("what a record needs", () => {
  it("a title", () => {
    const db = memoryDb();
    const error = refused(() => createRecord(db, "Announcements", { title: "  ", content: "c" }));
    assert.equal(error.code, "needTitle");
    assert.equal(error.field, "title");
    assert.equal(error.status, 400);
  });

  it("a link for a form, content or a link for anything else", () => {
    const db = memoryDb();
    assert.equal(refused(() => createRecord(db, "Forms", { title: "F", content: "c" })).code, "needFormLink");
    assert.equal(refused(() => createRecord(db, "Announcements", { title: "A" })).code, "needContent");
    createRecord(db, "Announcements", { title: "A", url: "https://example.com" });
    createRecord(db, "Announcements", { title: "B", content: "c" });
    createRecord(db, "Forms", { title: "F", url: "https://example.com/f" });
  });

  it("content of at most 45,000 characters", () => {
    const db = memoryDb();
    createRecord(db, "Announcements", { title: "A", content: "x".repeat(45000) });
    const error = refused(() => createRecord(db, "Announcements", { title: "B", content: "x".repeat(45001) }));
    assert.equal(error.code, "contentTooLong");
  });

  it("text that fits its field", () => {
    const db = memoryDb();
    createRecord(db, "Announcements", { title: "t".repeat(180), content: "c" });
    const error = refused(() => createRecord(db, "Announcements", { title: "t".repeat(181), content: "c" }));
    assert.equal(error.code, "fieldTooLong");
    assert.deepEqual(error.vars, { max: 180 });
    assert.equal(refused(() => createRecord(db, "Forms", { title: "F", url: "https://e.com", icon: "x".repeat(13) })).field, "icon");
  });

  it("web links only", () => {
    const db = memoryDb();
    for (const url of ["javascript:alert(1)", "ftp://example.com/a", "example.com", "#"]) {
      const error = refused(() => createRecord(db, "Forms", { title: "F", url }));
      assert.equal(error.code, "badUrl", url);
      assert.equal(error.field, "url");
    }
    assert.equal(
      refused(() => createRecord(db, "Announcements", { title: "A", content: "c", image: "data:image/png;base64,AAAA" }))
        .field,
      "image",
    );
    createRecord(db, "Announcements", { title: "A", content: "c", image: "http://example.com/a.png" });
  });

  it("real dates", () => {
    const db = memoryDb();
    for (const date of ["2026-02-30", "2026-13-01", "22/08/2026", "2026-8-2"]) {
      assert.equal(refused(() => createRecord(db, "Announcements", { title: "A", content: "c", date })).code, "badDate", date);
    }
    const error = refused(() =>
      createRecord(db, "Announcements", { title: "A", content: "c", pinned: true, pinExpires: "soon" }),
    );
    assert.equal(error.field, "pinExpires");
    assert.equal(createRecord(db, "Announcements", { title: "A", content: "c", date: "2028-02-29" }).date, "2028-02-29");
  });

  it("a pin order from 1 to 3 while pinned", () => {
    const db = memoryDb();
    for (const pinOrder of [0, 4, 1.5]) {
      const error = refused(() => createRecord(db, "Announcements", { title: "A", content: "c", pinned: true, pinOrder }));
      assert.equal(error.code, "badPinOrder", String(pinOrder));
    }
    createRecord(db, "Announcements", { title: "A", content: "c", pinned: false, pinOrder: 9 });
    assert.equal(createRecord(db, "Announcements", { title: "B", content: "c", pinned: true, pinOrder: 3 }).pinOrder, 3);
  });

  it("a date, for a numbered document", () => {
    const db = memoryDb();
    for (const section of ["ExecutiveOrders", "Memorandums", "Resolutions"] as const) {
      const error = refused(() =>
        createRecord(db, section, { title: "T", content: "c", subject: "S", memoTo: "A", memoFrom: "B" }),
      );
      assert.equal(error.code, "needDate", section);
    }
  });
});

describe("memorandums", () => {
  const memo = { subject: "Paksa", memoTo: "Hepe", memoFrom: "Alkalde", content: "c", date: "2026-01-02" };

  it("are titled by their subject", () => {
    const db = memoryDb();
    assert.equal(createRecord(db, "Memorandums", { ...memo, title: "ignored" }).title, "Paksa");
    const updated = updateRecord(db, "Memorandums", createRecord(db, "Memorandums", memo).id, { subject: "Bagong Paksa" });
    assert.equal(updated.title, "Bagong Paksa");
  });

  it("need a subject, a recipient and a sender", () => {
    const db = memoryDb();
    for (const field of ["subject", "memoTo", "memoFrom"] as const) {
      const error = refused(() => createRecord(db, "Memorandums", { ...memo, [field]: " " }));
      assert.equal(error.code, "needMemoFields", field);
      assert.equal(error.field, field);
    }
  });
});

describe("numbering a document", () => {
  it("hands out the next number the first time it is published, per section and year", () => {
    const db = memoryDb();
    const first = createRecord(db, "ExecutiveOrders", { ...order, autoNumber: true });
    assert.equal(first.number, "Executive Order Blg. 01, Serye ng 2026");
    assert.equal(first.publicationYear, 2026);
    assert.equal(first.publicationSequence, 1);
    assert.match(first.publishedAt, /^\d{4}-\d{2}-\d{2}T/);

    assert.equal(createRecord(db, "ExecutiveOrders", order).publicationSequence, 2);
    assert.equal(createRecord(db, "Resolutions", order).number, "Resolusyon Blg. 01, Serye ng 2026");
    assert.equal(
      createRecord(db, "Memorandums", { ...order, subject: "S", memoTo: "A", memoFrom: "B" }).number,
      "Memorandum Blg. 2026-01",
    );
    const next = createRecord(db, "ExecutiveOrders", { ...order, date: "2027-01-05" });
    assert.equal(next.number, "Executive Order Blg. 01, Serye ng 2027");
    assert.equal(counter(db, "ExecutiveOrders", 2026), 2);
  });

  it("numbers in the shapes the site reads back", () => {
    for (const section of ["ExecutiveOrders", "Memorandums", "Resolutions"] as const) {
      const number = formatNumber(section, 2026, 7);
      const record = { number, publicationYear: 0, publicationSequence: 0, date: "" };
      assert.equal(documentYear(record), 2026, number);
      assert.equal(documentSequence(record), 7, number);
    }
  });

  it("leaves a draft unnumbered, and numbers it when it is published", () => {
    const db = memoryDb();
    const draft = createRecord(db, "Resolutions", { ...order, published: false });
    assert.equal(draft.number, "");
    assert.equal(draft.publicationSequence, 0);
    assert.equal(draft.publishedAt, "");
    assert.equal(counter(db, "Resolutions", 2026), 0);

    const published = updateRecord(db, "Resolutions", draft.id, { published: true });
    assert.equal(published.number, "Resolusyon Blg. 01, Serye ng 2026");
    assert.equal(published.publicationSequence, 1);
  });

  it("keeps the number when a document is edited, unpublished and published again", () => {
    const db = memoryDb();
    const doc = createRecord(db, "ExecutiveOrders", order);
    const edited = updateRecord(db, "ExecutiveOrders", doc.id, { title: "Renamed", date: "2027-06-01", number: "changed" });
    assert.equal(edited.number, doc.number);
    assert.equal(edited.publicationSequence, 1);
    assert.equal(edited.publicationYear, 2026);
    assert.equal(edited.publishedAt, doc.publishedAt);

    updateRecord(db, "ExecutiveOrders", doc.id, { published: false });
    const again = updateRecord(db, "ExecutiveOrders", doc.id, { published: true });
    assert.equal(again.number, doc.number);
    assert.equal(counter(db, "ExecutiveOrders", 2026), 1);
  });

  it("never gives a deleted document's number to another", () => {
    const db = memoryDb();
    const doc = createRecord(db, "ExecutiveOrders", order);
    deleteRecord(db, "ExecutiveOrders", doc.id);
    assert.equal(createRecord(db, "ExecutiveOrders", order).publicationSequence, 2);
  });

  it("asks for a number when it is not automatic", () => {
    const db = memoryDb();
    const error = refused(() => createRecord(db, "ExecutiveOrders", { ...order, autoNumber: false }));
    assert.equal(error.code, "needNumber");
    assert.equal(error.field, "number");
    assert.equal(counter(db, "ExecutiveOrders", 2026), 0);

    // A draft doesn't need one yet.
    createRecord(db, "ExecutiveOrders", { ...order, autoNumber: false, published: false });
  });

  it("keeps a hand-typed number, and makes the next automatic one come after it", () => {
    const db = memoryDb();
    const manual = createRecord(db, "ExecutiveOrders", { ...order, autoNumber: false, number: "Blg. 07, Serye ng 2026" });
    assert.equal(manual.number, "Blg. 07, Serye ng 2026");
    assert.equal(manual.publicationYear, 2026);
    assert.equal(manual.publicationSequence, 0);
    assert.match(manual.publishedAt, /^\d{4}-/);
    assert.equal(counter(db, "ExecutiveOrders", 2026), 7);

    assert.equal(createRecord(db, "ExecutiveOrders", order).publicationSequence, 8);
  });

  it("continues from what an import found", () => {
    const db = memoryDb();
    importPayload(db, live);
    const next = createRecord(db, "Memorandums", { ...order, subject: "S", memoTo: "A", memoFrom: "B", date: "2026-10-02" });
    assert.equal(next.number, "Memorandum Blg. 2026-12");
  });

  it("refuses a number that is already in use, and takes nothing for it", () => {
    const db = memoryDb();
    importPayload(db, live);
    // Put the counter behind a stored number, the way a hand-edited database could be.
    db.prepare("UPDATE numbering SET last_sequence = 10 WHERE section = 'Memorandums' AND year = 2026").run();
    const memo = { ...order, subject: "S", memoTo: "A", memoFrom: "B" };

    const error = refused(() => createRecord(db, "Memorandums", memo));
    assert.equal(error.code, "numberTaken");
    assert.equal(error.status, 409);
    assert.equal(counter(db, "Memorandums", 2026), 10);
    assert.equal(listRecords(db, "Memorandums", { includeDrafts: true }).length, 11);
  });
});

describe("updateRecord", () => {
  it("changes only what it is given, keeps createdAt, and moves updatedAt", async () => {
    const db = memoryDb();
    const created = createRecord(db, "Announcements", { title: "T", content: "C", description: "D", icon: "📣", order: 4 });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = updateRecord(db, "Announcements", created.id, { title: "New", description: undefined, published: true });
    assert.equal(updated.title, "New");
    assert.equal(updated.description, "D");
    assert.equal(updated.icon, "📣");
    assert.equal(updated.order, 4);
    assert.equal(updated.published, true);
    assert.equal(updated.createdAt, created.createdAt);
    assert.ok(updated.updatedAt > created.updatedAt);
  });

  it("checks the result as a whole, and a refused change leaves the record alone", () => {
    const db = memoryDb();
    const created = createRecord(db, "Announcements", { title: "T", content: "C" });
    const error = refused(() => updateRecord(db, "Announcements", created.id, { content: "" }));
    assert.equal(error.code, "needContent");
    assert.deepEqual(getRecord(db, "Announcements", created.id), created);

    refused(() => updateRecord(db, "Announcements", created.id, { date: "2026-02-30" }));
    assert.deepEqual(getRecord(db, "Announcements", created.id), created);
  });

  it("cannot change the id, the section, or the numbering", () => {
    const db = memoryDb();
    const doc = createRecord(db, "ExecutiveOrders", order);
    const changes = { id: "other", section: "Forms", publicationSequence: 99, publishedAt: "x" } as object;
    const updated = updateRecord(db, "ExecutiveOrders", doc.id, changes);
    assert.equal(updated.id, doc.id);
    assert.equal(updated.publicationSequence, 1);
    assert.equal(updated.publishedAt, doc.publishedAt);
    assert.equal(getRecord(db, "ExecutiveOrders", "other"), undefined);
  });

  it("leaves columns a section doesn't use as they were", () => {
    const db = memoryDb();
    // The sheet also fills the memorandum columns on other tabs; the live forms have a subject.
    importPayload(db, payload({ Forms: [{ id: "f", title: "F", url: "https://e.com/f", subject: "  kept  ", watermarkImage: "w" }] }));
    updateRecord(db, "Forms", "f", { title: "Renamed" });
    const row = stored(db, "Forms", "f")!;
    assert.equal(row.title, "Renamed");
    assert.equal(row.subject, "kept");
    assert.equal(row.watermark_image, "w");
  });

  it("says when there is nothing to update", () => {
    const db = memoryDb();
    const error = refused(() => updateRecord(db, "Announcements", "nope", { title: "T" }));
    assert.equal(error.code, "recordNotFound");
    assert.equal(error.status, 404);
    // The same id in another section is a different record.
    createRecord(db, "Forms", { id: "x", title: "F", url: "https://e.com" });
    assert.equal(refused(() => updateRecord(db, "Announcements", "x", { title: "T" })).code, "recordNotFound");
  });

  it("edits a live record in place, and the build sees the edit", () => {
    const db = memoryDb();
    importPayload(db, live);
    const target = live.data.Announcements.find((row: { date: string }) => row.date);
    updateRecord(db, "Announcements", target.id, { title: "Binago", pinned: true, pinOrder: 2 });

    const site = normalizePayload(readPayload(db));
    const edited = site.sections.Announcements.find((item) => item.id === target.id)!;
    assert.equal(edited.title, "Binago");
    assert.equal(edited.pinned, true);
    assert.equal(edited.pinOrder, 2);
    assert.equal(site.sections.Announcements.length, live.data.Announcements.length);
  });
});

describe("deleteRecord and listRecords", () => {
  it("deletes one record in one section", () => {
    const db = memoryDb();
    createRecord(db, "Forms", { id: "x", title: "F", url: "https://e.com" });
    createRecord(db, "Announcements", { id: "x", title: "A", content: "c" });
    deleteRecord(db, "Announcements", "x");
    assert.equal(getRecord(db, "Announcements", "x"), undefined);
    assert.ok(getRecord(db, "Forms", "x"));
    assert.equal(refused(() => deleteRecord(db, "Announcements", "x")).status, 404);
  });

  it("lists in admin order, then newest first, and leaves out drafts unless asked", () => {
    const db = memoryDb();
    createRecord(db, "Announcements", { id: "old", title: "old", content: "c", date: "2026-01-01", published: true });
    createRecord(db, "Announcements", { id: "new", title: "new", content: "c", date: "2026-06-01", published: true });
    createRecord(db, "Announcements", { id: "first", title: "first", content: "c", date: "2026-03-01", order: -1, published: true });
    createRecord(db, "Announcements", { id: "draft", title: "draft", content: "c", date: "2026-09-01" });

    assert.deepEqual(listRecords(db, "Announcements").map((r) => r.id), ["first", "new", "old"]);
    assert.deepEqual(listRecords(db, "Announcements", { includeDrafts: true }).map((r) => r.id), ["first", "draft", "new", "old"]);
    assert.deepEqual(listRecords(db, "Forms"), []);
  });
});

describe("validators", () => {
  it("parse a section name", () => {
    assert.equal(parseSection("ExecutiveOrders"), "ExecutiveOrders");
    assert.equal(refused(() => parseSection("Settings")).code, "badSection");
    assert.equal(refused(() => parseSection("")).code, "badSection");
  });

  it("know a real date and a web link", () => {
    assert.ok(isIsoDate("2024-02-29"));
    assert.ok(!isIsoDate("2025-02-29"));
    assert.ok(!isIsoDate("2025-02-3"));
    assert.ok(isWebUrl("https://example.com/a?b=c"));
    assert.ok(isWebUrl("http://localhost:4321"));
    assert.ok(!isWebUrl("javascript:alert(1)"));
    assert.ok(!isWebUrl("//example.com"));
    assert.ok(!isWebUrl(""));
  });
});
