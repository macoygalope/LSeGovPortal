import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_DB_FILE } from "./data.ts";
import { DEFAULT_SETTINGS } from "./normalize.ts";
import { readSnapshot } from "./snapshot.ts";
import type { EgovData } from "./types.ts";

const data = { settings: { ...DEFAULT_SETTINGS, siteTitle: "Test" }, sections: {} } as unknown as EgovData;

describe("the copy a build keeps", () => {
  it("is made from the default database when it is there", async () => {
    const asked: string[] = [];
    const result = await readSnapshot({
      env: {},
      exists: (path) => (asked.push(path), true),
      load: async () => data,
      warn: () => assert.fail("nothing to warn about"),
    });
    assert.equal(result, data);
    assert.deepEqual(asked, [DEFAULT_DB_FILE]);
  });

  it("is skipped, with a warning that says what is lost, when no database was named and the default is absent", async () => {
    const warnings: string[] = [];
    const result = await readSnapshot({
      env: {},
      exists: () => false,
      load: async () => assert.fail("must not load"),
      warn: (m) => warnings.push(m),
    });
    assert.equal(result, null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /No data\/egov\.db.*no copy of the content to fall back on.*EGOV_DB_FILE/);
  });

  it("fails the build when a database or a saved response was named and cannot be read", async () => {
    for (const env of [{ EGOV_DB_FILE: "typo.db" }, { EGOV_DATA_FILE: "missing.json" }]) {
      await assert.rejects(
        readSnapshot({ env, exists: () => false, load: async () => Promise.reject(new Error("does not exist")), warn: () => {} }),
        /does not exist/,
      );
    }
  });

  it("fails the build when the default database is there and is broken", async () => {
    await assert.rejects(
      readSnapshot({ env: {}, exists: () => true, load: async () => Promise.reject(new Error("not an eGov database")), warn: () => {} }),
      /not an eGov database/,
    );
  });

  it("does not look for the default when one was named", async () => {
    const result = await readSnapshot({
      env: { EGOV_DB_FILE: "elsewhere.db" },
      exists: () => assert.fail("must not look"),
      load: async () => data,
    });
    assert.equal(result, data);
  });
});
