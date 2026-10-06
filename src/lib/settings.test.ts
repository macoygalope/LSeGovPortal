import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import type { DatabaseSync } from "node:sqlite";

import { importPayload, openDb, readPayload } from "./db.ts";
import { DEFAULT_SETTINGS, normalizePayload } from "./normalize.ts";
import { getSettings, saveSettings } from "./settings.ts";
import { AdminError } from "./validation.ts";

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

function refused(work: () => unknown): AdminError {
  try {
    work();
  } catch (error) {
    assert.ok(error instanceof AdminError, `expected an AdminError, got ${String(error)}`);
    return error;
  }
  assert.fail("expected the change to be refused");
}

describe("getSettings", () => {
  it("is the defaults for an empty database", () => {
    assert.deepEqual(getSettings(memoryDb()), DEFAULT_SETTINGS);
  });

  it("is what the site gets from the same database", () => {
    const db = memoryDb();
    importPayload(db, live);
    assert.deepEqual(getSettings(db), normalizePayload(readPayload(db)).settings);
    assert.equal(getSettings(db).mayorName, "Kgg. Alejandro Tagalog");
  });
});

describe("saveSettings", () => {
  it("saves what it is given, trimmed, and leaves the rest alone", () => {
    const db = memoryDb();
    importPayload(db, live);
    const before = getSettings(db);

    const saved = saveSettings(db, { siteTitle: "  Bagong Pangalan  ", logoUrl: "https://example.com/seal.png" });
    assert.deepEqual(saved, { ...before, siteTitle: "Bagong Pangalan", logoUrl: "https://example.com/seal.png" });
    assert.deepEqual(getSettings(db), saved);
    assert.equal(normalizePayload(readPayload(db)).settings.siteTitle, "Bagong Pangalan");
  });

  it("saves into an empty database, and again over what it saved", () => {
    const db = memoryDb();
    saveSettings(db, { footerText: "one" });
    saveSettings(db, { footerText: "two", mayorName: "Mayor" });
    assert.equal(getSettings(db).footerText, "two");
    assert.equal(getSettings(db).mayorName, "Mayor");
    assert.equal(Number(db.prepare("SELECT count(*) AS n FROM settings").get()!.n), 2);
  });

  it("falls back to the default for a setting that is emptied", () => {
    const db = memoryDb();
    saveSettings(db, { siteTitle: "Custom" });
    assert.equal(saveSettings(db, { siteTitle: "" }).siteTitle, DEFAULT_SETTINGS.siteTitle);
  });

  it("ignores names that aren't settings", () => {
    const db = memoryDb();
    saveSettings(db, { nonsense: "x", siteTitle: "T" } as object);
    assert.equal(Number(db.prepare("SELECT count(*) AS n FROM settings").get()!.n), 1);
  });

  it("refuses links that aren't web addresses, and saves nothing", () => {
    const db = memoryDb();
    const error = refused(() => saveSettings(db, { siteTitle: "T", meetingUrl: "javascript:alert(1)" }));
    assert.equal(error.code, "badUrl");
    assert.equal(error.field, "meetingUrl");
    assert.equal(Number(db.prepare("SELECT count(*) AS n FROM settings").get()!.n), 0);
    saveSettings(db, { meetingUrl: "" });
  });

  it("refuses text that is too long", () => {
    const db = memoryDb();
    saveSettings(db, { siteTitle: "t".repeat(100) });
    const error = refused(() => saveSettings(db, { siteTitle: "t".repeat(101) }));
    assert.equal(error.code, "fieldTooLong");
    assert.equal(error.field, "siteTitle");
    assert.deepEqual(error.vars, { max: 100 });
  });
});
