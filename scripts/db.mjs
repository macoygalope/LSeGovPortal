// Manages the local SQLite copy of the eGov sheet (src/lib/db.ts).
//
//   npm run db:import -- --file fixtures/live-all.json   load a saved response
//   npm run db:import -- --file backup.json --replace    overwrite what is already there
//   npm run db:export -- --out backup.json               dump it, drafts included
//   npm run db:migrate                                   bring an older database up to date
//
// --db <path> picks the database file; it defaults to $EGOV_DB_FILE, then
// data/egov.db, which is also what a build reads: npm run build:kiosk

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { DEFAULT_DB_FILE } from "../src/lib/data.ts";
import { importPayload, openDb, readPayload } from "../src/lib/db.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    db: { type: "string" },
    file: { type: "string" },
    replace: { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const [command] = positionals;
const dbPath = values.db || process.env.EGOV_DB_FILE || DEFAULT_DB_FILE;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function loadPayload() {
  if (!values.file) fail("Say where to import from: --file <saved response.json>.");
  return JSON.parse(readFileSync(values.file, "utf8"));
}

try {
  if (command === "import") {
    const payload = loadPayload();
    const db = openDb(dbPath);
    try {
      const summary = importPayload(db, payload, { replace: values.replace });
      console.log(`Imported into ${dbPath}`);
      const rows = [
        ["settings", summary.settings],
        ...Object.entries(summary.records),
        ["numbered series", summary.series],
      ];
      for (const [label, n] of rows) console.log(`  ${label.padEnd(17)}${n}`);
    } finally {
      db.close();
    }
  } else if (command === "export") {
    const db = openDb(dbPath);
    try {
      const json = JSON.stringify(readPayload(db, { includeDrafts: true }), null, 2);
      if (values.out) {
        writeFileSync(values.out, `${json}\n`);
        console.log(`Wrote ${values.out}`);
      } else {
        console.log(json);
      }
    } finally {
      db.close();
    }
  } else if (command === "migrate") {
    openDb(dbPath).close();
    console.log(`${dbPath} is up to date.`);
  } else {
    fail("Usage: node scripts/db.mjs <import|export|migrate> [--db path] [--file path] [--replace] [--out path]");
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
