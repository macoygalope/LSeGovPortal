import { readFile } from "node:fs/promises";
import { normalizePayload } from "./normalize.ts";
import type { EgovData } from "./types.ts";

/** Where a build reads, and `npm run db:*` writes, the database unless told otherwise. */
export const DEFAULT_DB_FILE = "data/egov.db";

async function load(): Promise<EgovData> {
  // A saved `action=all` response, e.g. fixtures/live-all.json.
  const dataFile = process.env.EGOV_DATA_FILE;
  if (dataFile) {
    return normalizePayload(JSON.parse(await readFile(dataFile, "utf8")));
  }

  // The local SQLite copy of the sheet (see db.ts). Loaded on demand so that
  // node:sqlite is only touched by builds that read from it.
  const { readPayloadFromFile } = await import("./db.ts");
  return normalizePayload(readPayloadFromFile(process.env.EGOV_DB_FILE || DEFAULT_DB_FILE));
}

// Every page calls getEgovData(); the data is read once per build, and a
// failure must fail the whole build rather than publish a half-empty site
// over the last good one.
let cached: Promise<EgovData> | undefined;

export function getEgovData(): Promise<EgovData> {
  // A dev server outlives changes to the database (npm run admin saves them
  // while it runs), so it reads again on every call. `env` is missing when
  // this runs under plain Node, as it does in the tests.
  if (import.meta.env?.DEV) return load();
  cached ??= load();
  return cached;
}
