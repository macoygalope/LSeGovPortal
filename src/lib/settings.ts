import type { DatabaseSync } from "node:sqlite";

import { inTransaction } from "./db.ts";
import { DEFAULT_SETTINGS, normalizeSettings, toText } from "./normalize.ts";
import type { SiteSettings } from "./types.ts";
import { checkLength, checkUrl } from "./validation.ts";

// Read and write the site settings (the `settings` table), as the dashboard's
// "Mga Larawan at Ayos" tab needs them. Like the sheet's Settings tab, a
// setting left empty means "use the default", which is what a build does too.

/** Settings that are web addresses. */
const URL_SETTINGS: readonly (keyof SiteSettings)[] = [
  "heroImageUrl",
  "logoUrl",
  "mayorImageUrl",
  "meetingUrl",
  "defaultDocumentImageUrl",
  "defaultSignatureImageUrl",
];

/** Longest text each setting takes (the dashboard's `maxlength`s). */
const MAX_LENGTH: Partial<Record<keyof SiteSettings, number>> = {
  siteTitle: 100,
  siteSubtitle: 140,
  heroTitle: 220,
  heroDescription: 700,
  mayorName: 120,
  meetingButtonLabel: 80,
  defaultSignatoryName: 160,
  defaultSignatoryPosition: 180,
  footerText: 220,
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof SiteSettings)[];

const UPSERT = `INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT (key) DO UPDATE SET
    value = excluded.value,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

/** The settings as the site uses them: what is stored, with the defaults filling the gaps. */
export function getSettings(db: DatabaseSync): SiteSettings {
  const stored: Record<string, unknown> = {};
  for (const row of db.prepare("SELECT key, value FROM settings").all()) stored[String(row.key)] = row.value;
  return normalizeSettings(stored);
}

/**
 * Saves the settings it is given (others stay as they are, and unknown names
 * are ignored) and returns all of them. Nothing is saved if any is refused.
 */
export function saveSettings(db: DatabaseSync, changes: Partial<Record<keyof SiteSettings, unknown>>): SiteSettings {
  const values = new Map<keyof SiteSettings, string>();
  for (const key of SETTING_KEYS) {
    if (changes[key] === undefined) continue;
    const value = toText(changes[key]);
    const max = MAX_LENGTH[key];
    if (max !== undefined) checkLength(key, value, max);
    if (URL_SETTINGS.includes(key)) checkUrl(key, value);
    values.set(key, value);
  }

  inTransaction(db, () => {
    const upsert = db.prepare(UPSERT);
    for (const [key, value] of values) upsert.run(key, value);
  });
  return getSettings(db);
}
