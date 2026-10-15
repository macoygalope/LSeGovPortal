import { existsSync } from "node:fs";

import { DEFAULT_DB_FILE, getEgovData } from "./data.ts";
import { DEFAULT_SETTINGS } from "./normalize.ts";
import type { EgovData, SiteSettings } from "./types.ts";

// The copy of the content a build keeps for the pages to fall back on when
// lspd-backend does not answer (src/lib/site-source.ts). The pages read the
// content live; this is only what they show if that fails, and the first
// words of each page (the title, the footer) before it arrives.
//
// It comes from where a build always read: a database (EGOV_DB_FILE, default
// data/egov.db; a copy of lspd-backend's site.db will do) or a saved response
// (EGOV_DATA_FILE). A build that was told where the content is, and cannot read
// it, fails: the same rule as before. A build that was not told, and finds no
// default database, goes on without a copy and says so, because the content
// no longer has to be on the machine that builds the site.

export interface SnapshotDeps {
  load?: () => Promise<EgovData>;
  env?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
  warn?: (message: string) => void;
}

/** The content as it is now, drafts left out; `null` when this build has none to copy. */
export async function readSnapshot(deps: SnapshotDeps = {}): Promise<EgovData | null> {
  const { load = getEgovData, env = process.env, exists = existsSync, warn = console.warn } = deps;
  const told = Boolean(env.EGOV_DATA_FILE || env.EGOV_DB_FILE);
  if (!told && !exists(DEFAULT_DB_FILE)) {
    warn(
      `[egov] No ${DEFAULT_DB_FILE}: this build has no copy of the content to fall back on, so a page that ` +
        "cannot reach lspd-backend shows nothing. Point EGOV_DB_FILE at a copy of lspd-backend's site.db to include one.",
    );
    return null;
  }
  return load();
}

let cached: Promise<EgovData | null> | undefined;

/** readSnapshot, once per build (a dev server reads again, as it does for everything else). */
export function getSnapshot(): Promise<EgovData | null> {
  if (import.meta.env?.DEV) return readSnapshot();
  cached ??= readSnapshot();
  return cached;
}

/** The settings the build's own markup (title, footer, hero) starts from, before the live ones replace them. */
export async function getBuildSettings(): Promise<SiteSettings> {
  return (await getSnapshot())?.settings ?? DEFAULT_SETTINGS;
}
