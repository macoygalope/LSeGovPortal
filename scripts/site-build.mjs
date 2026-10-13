// Builds the copy of the eGov database that goes on a server: only what the
// public_* views (migration 3) can show, with the drafts, forms, admin list and
// numbering counters removed.
//
//   npm run site:build -- --out site.db
//   npm run site:build -- --out D:/lspd-backend/data/sites/egov/site.db --db data/egov.db
//
// lspd-backend serves this file, read-only, through those views. The database
// you edit stays on this machine: this only reads it, so it is safe to run while
// the dashboard is open. --db picks the source (default $EGOV_DB_FILE, then
// data/egov.db); --out is the file to write, replaced if it is already a
// database and never the source itself. The source must have had migration 3
// (npm run db:migrate).

import { parseArgs } from "node:util";

import { DEFAULT_DB_FILE } from "../src/lib/data.ts";
import { buildPublicDatabase } from "../src/lib/public-db.ts";

const { values } = parseArgs({
  options: { db: { type: "string" }, out: { type: "string" } },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!values.out) fail("Usage: npm run site:build -- --out <file> [--db <source database>]");
const source = values.db || process.env.EGOV_DB_FILE || DEFAULT_DB_FILE;

try {
  const built = buildPublicDatabase(source, values.out);
  const counts = Object.entries(built.records)
    .map(([section, n]) => `${section} ${n}`)
    .join(", ");
  console.log(`Built ${built.out} (${(built.bytes / 1024).toFixed(0)} KB) from ${source}`);
  console.log(`  public_records:  ${counts}`);
  console.log(`  public_settings: ${built.settings} rows`);
  console.log(
    `  left out: ${built.removed.records} records (drafts, forms or unpublished), ` +
      `${built.removed.admins} admins, ${built.removed.numbering} numbering rows`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
