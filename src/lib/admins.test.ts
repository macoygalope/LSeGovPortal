import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { DatabaseSync } from "node:sqlite";

import { addAdmin, getAdmin, listAdmins, normalizeCitizenId, removeAdmin } from "./admins.ts";
import { openDb } from "./db.ts";
import { AdminError } from "./validation.ts";

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

describe("addAdmin", () => {
  it("whitelists a citizen, and returns them as stored", () => {
    const db = memoryDb();
    const admin = addAdmin(db, "ABC12345", "Alejandro Tagalog");
    assert.equal(admin.citizenId, "ABC12345");
    assert.equal(admin.name, "Alejandro Tagalog");
    assert.match(admin.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(getAdmin(db, "ABC12345"), admin);
  });

  it("trims what it is given", () => {
    const db = memoryDb();
    const admin = addAdmin(db, "  ABC12345\n", "  Mayor  ");
    assert.equal(admin.citizenId, "ABC12345");
    assert.equal(admin.name, "Mayor");
  });

  it("refuses the same citizen twice, however the id is capitalised", () => {
    const db = memoryDb();
    addAdmin(db, "ABC12345", "One");
    for (const again of ["ABC12345", "abc12345", "Abc12345"]) {
      const error = refused(() => addAdmin(db, again, "Two"));
      assert.equal(error.code, "adminExists", again);
      assert.equal(error.status, 409);
    }
    assert.equal(listAdmins(db).length, 1);
    assert.equal(getAdmin(db, "ABC12345")!.name, "One");
  });

  it("needs an id without spaces, and a name", () => {
    const db = memoryDb();
    assert.equal(refused(() => addAdmin(db, "  ", "Name")).code, "needCitizenId");
    assert.equal(refused(() => addAdmin(db, undefined, "Name")).code, "needCitizenId");
    assert.equal(refused(() => addAdmin(db, "ABC 123", "Name")).code, "badCitizenId");
    assert.equal(refused(() => addAdmin(db, "ABC12345", " ")).code, "needAdminName");
    assert.equal(refused(() => addAdmin(db, "x".repeat(65), "Name")).code, "fieldTooLong");
    assert.equal(refused(() => addAdmin(db, "ABC12345", "n".repeat(161))).code, "fieldTooLong");
    assert.equal(listAdmins(db).length, 0);
  });
});

describe("getAdmin", () => {
  it("finds a citizen however their id is capitalised or padded", () => {
    const db = memoryDb();
    addAdmin(db, "ABC12345", "Mayor");
    for (const given of ["ABC12345", "abc12345", " ABC12345 "]) {
      assert.equal(getAdmin(db, given)?.name, "Mayor", given);
    }
  });

  it("finds nobody for an id that isn't on the list, or isn't an id", () => {
    const db = memoryDb();
    addAdmin(db, "ABC12345", "Mayor");
    for (const given of ["ABC1234", "ABC123456", "", "  ", undefined, null, 12345, "ABC%", "%", "ABC12345' OR '1'='1"]) {
      assert.equal(getAdmin(db, given), undefined, String(given));
    }
  });
});

describe("listAdmins and removeAdmin", () => {
  it("lists in the order added, and removes one", () => {
    const db = memoryDb();
    addAdmin(db, "AAA00001", "First");
    addAdmin(db, "BBB00002", "Second");
    addAdmin(db, "CCC00003", "Third");
    assert.deepEqual(listAdmins(db).map((a) => a.name), ["First", "Second", "Third"]);

    removeAdmin(db, "bbb00002");
    assert.deepEqual(listAdmins(db).map((a) => a.citizenId), ["AAA00001", "CCC00003"]);
    assert.equal(getAdmin(db, "BBB00002"), undefined);
  });

  it("says when there is nobody to remove", () => {
    const db = memoryDb();
    const error = refused(() => removeAdmin(db, "ABC12345"));
    assert.equal(error.code, "adminNotFound");
    assert.equal(error.status, 404);
  });

  it("can add someone back after removing them", () => {
    const db = memoryDb();
    addAdmin(db, "ABC12345", "Old name");
    removeAdmin(db, "ABC12345");
    assert.equal(addAdmin(db, "ABC12345", "New name").name, "New name");
  });
});

describe("normalizeCitizenId", () => {
  it("trims, and turns nothing into an empty string", () => {
    assert.equal(normalizeCitizenId("  ABC12345 "), "ABC12345");
    assert.equal(normalizeCitizenId(undefined), "");
    assert.equal(normalizeCitizenId(null), "");
  });
});
