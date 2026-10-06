// Runs the admin dashboard: an Astro dev server with the /admin page and the
// API behind it (src/lib/admin-api.ts), editing the local database.
//
//   npm run admin                        http://127.0.0.1:4322/admin
//   npm run admin -- --port 5000         another port
//   npm run admin -- --db backup.db      another database file
//
// Only citizens on the database's admin list can sign in, by citizen ID: see
// `npm run admins`. Open /admin?citizenId=ABC12345, or type the ID in. It
// listens on this machine only unless you pass --host. Changes are saved
// straight to the database; the site only shows them after the next build
// (npm run build:kiosk).

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { dev } from "astro";

import { adminIntegration } from "../src/lib/admin-integration.ts";
import { listAdmins } from "../src/lib/admins.ts";
import { DEFAULT_DB_FILE } from "../src/lib/data.ts";
import { openDb } from "../src/lib/db.ts";

const { values } = parseArgs({
  options: {
    db: { type: "string" },
    port: { type: "string" },
    host: { type: "string" },
  },
});

const dbPath = values.db || process.env.EGOV_DB_FILE || DEFAULT_DB_FILE;
const host = values.host || "127.0.0.1";
const port = Number(values.port || 4322);
const loopback = ["127.0.0.1", "localhost", "::1"].includes(host);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`"${values.port}" is not a port number.`);

// A build refuses a database that isn't there, and so does this: a mistyped
// --db would otherwise quietly start an empty one.
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
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
// A build may be reading the file while a change is saved: wait for it.
db.exec("PRAGMA busy_timeout = 5000");
// The site this server also serves reads the database the way a build does.
process.env.EGOV_DB_FILE = dbPath;

const server = await dev({
  root: resolve(import.meta.dirname, ".."),
  logLevel: "warn",
  devToolbar: { enabled: false },
  // A named --host is a choice to be reached from elsewhere, by whatever name.
  server: { host, port, ...(loopback ? {} : { allowedHosts: true }) },
  integrations: [adminIntegration({ db, databaseName: dbPath, log: (message) => console.log(`[admin] ${message}`) })],
});

const { address, port: boundPort } = server.address;
const shownHost = address === "::" || address === "0.0.0.0" || address === "::1" ? "localhost" : address;
console.log("Los Santos eGov admin");
console.log(`  Dashboard  http://${shownHost}:${boundPort}/admin`);
console.log(`  Database   ${dbPath}`);
const admins = listAdmins(db);
console.log(`  Admins     ${admins.length} on the list (npm run admins -- list)`);
const mock = (process.env.PUBLIC_MOCK_CITIZEN_ID ?? "").trim();
if (mock) {
  const listed = admins.some((admin) => admin.citizenId.toLowerCase() === mock.toLowerCase());
  console.log(`  Mock ID    ${mock} (PUBLIC_MOCK_CITIZEN_ID): the dashboard signs in as them when the browser has no citizen ID`);
  if (!listed) console.warn(`             ...but they are not on the admin list: npm run admins -- add ${mock} "Mock Test Admin"`);
}
console.log("\nChanges reach the site on the next build: npm run build:kiosk");
if (admins.length === 0) {
  console.warn('\nNobody can sign in yet. Add yourself: npm run admins -- add <citizenId> "<your name>"');
}
if (process.env.EGOV_ADMIN_TOKEN) {
  console.warn("\nEGOV_ADMIN_TOKEN is no longer used: sign-in is by citizen ID now.");
}
if (process.env.EGOV_DATA_FILE) {
  console.warn(`\nEGOV_DATA_FILE is set, so the site shown here comes from that file, not the database.`);
}
if (!loopback) {
  console.warn(
    `\nListening on ${host}, over plain HTTP. A citizen ID is not a secret: anyone who can reach this port and knows an admin's ID can sign in as them and edit the site.`,
  );
}

async function stop() {
  await server.stop();
  db.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
