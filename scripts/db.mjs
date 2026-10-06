// Manages the local SQLite copy of the eGov sheet (src/lib/db.ts).
//
//   npm run db:import -- --file fixtures/live-all.json   load a saved response
//   npm run db:import -- --live                          load from the Apps Script backend
//   npm run db:import -- --live --replace                overwrite what is already there
//   npm run db:export -- --out backup.json               dump it, drafts included
//   npm run db:migrate                                   bring an older database up to date
//
// --db <path> picks the database file; it defaults to $EGOV_DB_FILE, then
// data/egov.db. To build the site from it: EGOV_DB_FILE=data/egov.db npm run build:kiosk

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { fetchLivePayload } from "../src/lib/data.ts";
import { importPayload, openDb, readPayload } from "../src/lib/db.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    db: { type: "string" },
    file: { type: "string" },
    live: { type: "boolean", default: false },
    replace: { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const [command] = positionals;
const dbPath = values.db || process.env.EGOV_DB_FILE || "data/egov.db";

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function loadPayload() {
  if (values.file && values.live) fail("Pass --file or --live, not both.");
  if (values.file) return JSON.parse(readFileSync(values.file, "utf8"));
  if (values.live) {
    const apiUrl = process.env.PUBLIC_EGOV_API_URL;
    if (!apiUrl || apiUrl.includes("REPLACE_ME")) fail("PUBLIC_EGOV_API_URL is not set (see .env.example).");
    return fetchLivePayload(apiUrl);
  }
  return fail("Say where to import from: --file <saved response.json> or --live.");
}

try {
  if (command === "import") {
    const payload = await loadPayload();
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
      if (values.live) console.log("\nThe backend only returns published records, so drafts are not included.");
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
    fail("Usage: node scripts/db.mjs <import|export|migrate> [--db path] [--file path | --live] [--replace] [--out path]");
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
