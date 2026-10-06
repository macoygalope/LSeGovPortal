import { readFile } from "node:fs/promises";
import { normalizePayload } from "./normalize.ts";
import type { EgovData } from "./types.ts";

const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 3;

async function fetchLivePayload(apiUrl: string): Promise<unknown> {
  const url = new URL(apiUrl);
  url.searchParams.set("action", "all");

  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      // Apps Script answers /exec with a redirect to googleusercontent.com;
      // fetch follows it by default.
      const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error(
    `Could not fetch eGov data from the Apps Script backend after ${FETCH_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function load(): Promise<EgovData> {
  const dataFile = process.env.EGOV_DATA_FILE;
  if (dataFile) {
    return normalizePayload(JSON.parse(await readFile(dataFile, "utf8")));
  }

  const apiUrl = import.meta.env.PUBLIC_EGOV_API_URL;
  if (!apiUrl || apiUrl.includes("REPLACE_ME")) {
    throw new Error(
      "PUBLIC_EGOV_API_URL is not set. Copy .env.example to .env, or set EGOV_DATA_FILE to build from a saved response.",
    );
  }
  return normalizePayload(await fetchLivePayload(apiUrl));
}

// Every page calls getEgovData(); the backend must only be hit once per
// build, and a failure must fail the whole build rather than publish a
// half-empty site over the last good one.
let cached: Promise<EgovData> | undefined;

export function getEgovData(): Promise<EgovData> {
  cached ??= load();
  return cached;
}
