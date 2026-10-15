import { normalizeRecord, normalizeSettings, normalizePayload, toText } from "./normalize.ts";
import { SECTIONS, type EgovData, type EgovRecord, type Section } from "./types.ts";

// Where a page gets its content when it opens in the browser, with no Node and
// no import.meta.env, so it runs the same in a test.
//
//   1. lspd-backend's two views of the site's database, read live
//      (`<live>/db/site_records` and `<live>/db/site_settings`; migration 5 in
//      lspd-backend's internal/egov). A record published in the game shows the
//      next time a page opens. They answer with the columns of the site's own
//      data payload, so what comes back goes through the same normalising as a
//      build always did (normalizePayload): the only change is that booleans,
//      which the database keeps as 0 and 1, are made true and false.
//   2. The copy made at build time (`/assets/snapshot.json`: only what was
//      published then), used when the live answer does not come.
//
// Nothing here ever shows a draft: the views do not select one, and normalising
// drops an unpublished row whatever sent it.

/** The views a page reads, under `<live>/db/`. */
export const SITE_VIEW_RECORDS = "site_records";
export const SITE_VIEW_SETTINGS = "site_settings";

/** Columns the database keeps as 0 and 1. */
const BOOLEAN_COLUMNS = ["published", "pinned", "autoNumber"] as const;

/**
 * Rows of public_site_records and public_site_settings as the `action=all`
 * payload that normalizePayload reads.
 */
export function payloadFromViews(
  records: readonly unknown[],
  settings: readonly unknown[],
): { ok: true; data: Record<string, unknown> } {
  const bySection = Object.fromEntries(SECTIONS.map((section) => [section, [] as Record<string, unknown>[]]));

  for (const row of records) {
    if (!row || typeof row !== "object") throw new Error("a record row is not an object");
    const record: Record<string, unknown> = { ...(row as Record<string, unknown>) };
    for (const column of BOOLEAN_COLUMNS) record[column] = record[column] === 1 || record[column] === true;
    // A section this page does not know is not shown rather than an error: the
    // database may be newer than the page.
    if (typeof record.section === "string" && (SECTIONS as readonly string[]).includes(record.section)) {
      bySection[record.section]!.push(record);
    }
  }

  const siteSettings = Object.fromEntries(
    settings.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const { key, value } = row as { key?: unknown; value?: unknown };
      return typeof key === "string" ? [[key, toText(value)] as const] : [];
    }),
  );

  return { ok: true, data: { ...bySection, SiteSettings: siteSettings } };
}

/** What the build writes to `assets/snapshot.json`; `null` when this build had no content to copy. */
export function serializeSnapshot(data: EgovData | null): string {
  return JSON.stringify(data ? { ok: true, data } : { ok: false });
}

/** The reverse of serializeSnapshot. Every record goes through normalizeRecord again: the file is only as good as what is read from it. */
export function dataFromSnapshot(body: unknown): EgovData {
  const parsed = body as { ok?: unknown; data?: { settings?: unknown; sections?: unknown } } | null;
  if (!parsed || typeof parsed !== "object" || parsed.ok !== true) {
    throw new Error("this build has no copy of the content");
  }
  const { settings, sections } = parsed.data ?? {};
  if (!sections || typeof sections !== "object") throw new Error("the copy of the content has no sections");

  const result = {} as Record<Section, EgovRecord[]>;
  for (const section of SECTIONS) {
    const rows = (sections as Record<string, unknown>)[section];
    if (!Array.isArray(rows)) throw new Error(`the copy of the content is missing "${section}"`);
    result[section] = rows
      .map((row) => normalizeRecord(row as Record<string, unknown>))
      .filter((record) => record.id && record.published);
  }
  return { settings: normalizeSettings(settings as Record<string, unknown> | undefined), sections: result };
}

export type DataSource = "live" | "snapshot";

export interface LoadOptions {
  /** The site's address on lspd-backend, no trailing slash ("/api/v1/websites/egov"); "" when there is none to ask. */
  liveBase: string;
  /** Where the build-time copy is; "" when there is none. */
  snapshotUrl: string;
  fetchImpl?: typeof fetch;
  /** A request that takes longer is given up on. */
  timeoutMs?: number;
  /** Told why the live answer was not used. */
  warn?: (message: string) => void;
}

export interface LoadedData {
  data: EgovData;
  source: DataSource;
}

async function getJson(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // no-cache: ask lspd-backend whether anything changed (its ETag makes the
    // answer nearly free) rather than trust what the browser kept.
    const response = await fetchImpl(url, {
      cache: "no-cache",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function rowsOf(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<unknown[]> {
  const body = (await getJson(fetchImpl, url, timeoutMs)) as { rows?: unknown } | null;
  if (!body || !Array.isArray(body.rows)) throw new Error(`${url} did not answer with rows`);
  return body.rows;
}

/** The two live views, together or not at all: half of a site is never shown. */
export async function loadLive(liveBase: string, fetchImpl: typeof fetch, timeoutMs = 8000): Promise<EgovData> {
  const [records, settings] = await Promise.all([
    rowsOf(fetchImpl, `${liveBase}/db/${SITE_VIEW_RECORDS}`, timeoutMs),
    rowsOf(fetchImpl, `${liveBase}/db/${SITE_VIEW_SETTINGS}`, timeoutMs),
  ]);
  return normalizePayload(payloadFromViews(records, settings));
}

/**
 * The content to show: live if it answers, else the build's copy. Throws, with
 * both reasons, only when neither does.
 */
export async function loadSiteData(options: LoadOptions): Promise<LoadedData> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 8000;
  const warn = options.warn ?? ((message: string) => console.warn(`[egov] ${message}`));
  const problems: string[] = [];

  if (options.liveBase) {
    try {
      return { data: await loadLive(options.liveBase, fetchImpl, timeoutMs), source: "live" };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      problems.push(`live: ${reason}`);
      warn(`the live content did not load (${reason})${options.snapshotUrl ? "; using the copy made at build time" : ""}`);
    }
  }

  if (options.snapshotUrl) {
    try {
      return { data: dataFromSnapshot(await getJson(fetchImpl, options.snapshotUrl, timeoutMs)), source: "snapshot" };
    } catch (error) {
      problems.push(`copy: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`No eGov content could be loaded (${problems.join("; ") || "nothing to ask"}).`);
}
