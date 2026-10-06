// Manages who may sign in to the admin dashboard (src/lib/admins.ts): the
// citizens in the database's `site_admins` table, by the citizenid the game
// gives them.
//
//   npm run admins -- list
//   npm run admins -- add ABC12345 "Alejandro Tagalog"
//   npm run admins -- remove ABC12345
//
// --db <path> picks the database file; it defaults to $EGOV_DB_FILE, then
// data/egov.db. It is done from here, not the dashboard, so the first admin
// doesn't have to be let in by someone who isn't one yet. A running dashboard
// notices straight away: removing someone signs them out.

import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { addAdmin, listAdmins, removeAdmin } from "../src/lib/admins.ts";
import { DEFAULT_DB_FILE } from "../src/lib/data.ts";
import { openDb } from "../src/lib/db.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { db: { type: "string" } },
});

const [command, citizenId, ...nameWords] = positionals;
const dbPath = values.db || process.env.EGOV_DB_FILE || DEFAULT_DB_FILE;
const USAGE = 'Usage: node scripts/admins.mjs <list | add <citizenId> <name> | remove <citizenId>> [--db path]';

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!["list", "add", "remove"].includes(command ?? "")) fail(USAGE);
if (!existsSync(dbPath)) {
  fail(
    `The eGov database "${dbPath}" does not exist (set EGOV_DB_FILE or pass --db to use another path).\n` +
      "Create it with: npm run db:import -- --file fixtures/live-all.json\n" +
      "or start an empty one with: npm run db:migrate",
  );
}

let db;
try {
  db = openDb(dbPath);
  if (command === "list") {
    const admins = listAdmins(db);
    if (admins.length === 0) {
      console.log(`Nobody is on the admin list in ${dbPath}. Add someone: npm run admins -- add <citizenId> "<name>"`);
    }
    for (const admin of admins) {
      console.log(`${admin.citizenId.padEnd(14)}${admin.name}  (added ${admin.createdAt.slice(0, 10)})`);
    }
  } else if (command === "add") {
    if (!citizenId) fail(USAGE);
    const admin = addAdmin(db, citizenId, nameWords.join(" "));
    console.log(`${admin.name} (${admin.citizenId}) can now sign in to the admin dashboard.`);
  } else {
    if (!citizenId) fail(USAGE);
    removeAdmin(db, citizenId);
    console.log(`${citizenId} can no longer sign in to the admin dashboard.`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  db?.close();
}
