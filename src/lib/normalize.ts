import { t } from "./i18n.ts";
import {
  SECTIONS,
  type EgovData,
  type EgovRecord,
  type Section,
  type SiteSettings,
} from "./types.ts";

export const DEFAULT_SETTINGS: SiteSettings = {
  siteTitle: "Los Santos eGov",
  siteSubtitle: t("settings.siteSubtitle"),
  heroTitle: t("settings.heroTitle"),
  heroDescription: t("settings.heroDescription"),
  heroImageUrl: "",
  logoUrl: "",
  mayorImageUrl: "",
  mayorName: "Hon. Alejandro Tagalog",
  meetingButtonLabel: t("settings.meetingButtonLabel"),
  meetingUrl: "",
  defaultDocumentImageUrl: "",
  defaultSignatureImageUrl: "",
  defaultSignatoryName: "Alejandro Tagalog",
  defaultSignatoryPosition: t("settings.defaultSignatoryPosition"),
  footerText: t("settings.footerText"),
};

/** Sheets hands back booleans as true/false or "TRUE"/"true"/"false". */
export function toBool(value: unknown): boolean {
  return value === true || String(value ?? "").trim().toLowerCase() === "true";
}

export function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function toText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

export function normalizeRecord(raw: Record<string, unknown>): EgovRecord {
  return {
    id: toText(raw.id),
    title: toText(raw.title),
    description: toText(raw.description),
    number: toText(raw.number),
    date: toText(raw.date),
    url: toText(raw.url),
    image: toText(raw.image),
    icon: toText(raw.icon),
    order: toNumber(raw.order),
    published: toBool(raw.published),
    // Body text keeps its internal whitespace; only the edges are trimmed.
    content: toText(raw.content),
    publicationYear: toNumber(raw.publicationYear),
    publicationSequence: toNumber(raw.publicationSequence),
    publishedAt: toText(raw.publishedAt),
    pinned: toBool(raw.pinned),
    pinOrder: toNumber(raw.pinOrder, 1),
    pinExpires: toText(raw.pinExpires),
    subject: toText(raw.subject),
    memoTo: toText(raw.memoTo),
    memoFrom: toText(raw.memoFrom),
    signatureImage: toText(raw.signatureImage),
    signatoryName: toText(raw.signatoryName),
    signatoryPosition: toText(raw.signatoryPosition),
  };
}

export function normalizeSettings(raw: Record<string, unknown> | undefined): SiteSettings {
  const merged: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const value = raw?.[key];
    // An empty cell means "use the default" only for text that must never be
    // blank; image/link fields are legitimately empty by default anyway.
    if (value != null && toText(value) !== "") merged[key] = toText(value);
  }
  return merged as unknown as SiteSettings;
}

/** The `data` object of an Apps Script response; throws if it is an error or malformed. */
export function payloadData(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    throw new Error("eGov payload is not an object.");
  }
  const body = payload as { ok?: unknown; error?: unknown; data?: unknown };
  if (body.ok === false) {
    throw new Error(`eGov backend error: ${toText(body.error) || "unknown"}`);
  }
  const data = body.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") {
    throw new Error("eGov payload has no data.");
  }
  return data;
}

/** The raw rows of one section. A payload must carry every section, even empty. */
export function payloadRows(data: Record<string, unknown>, section: Section): unknown[] {
  const rows = data[section];
  if (!Array.isArray(rows)) {
    throw new Error(`eGov payload is missing the "${section}" section.`);
  }
  return rows;
}

/**
 * Turns an Apps Script `action=all` payload into typed data. Unpublished
 * records and records without an id are dropped here, so nothing downstream
 * can leak a draft into the static output.
 */
export function normalizePayload(payload: unknown): EgovData {
  const data = payloadData(payload);

  const sections = {} as Record<Section, EgovRecord[]>;
  for (const section of SECTIONS) {
    sections[section] = payloadRows(data, section)
      .map((row) => normalizeRecord(row as Record<string, unknown>))
      .filter((record) => record.id && record.published);
  }

  return {
    settings: normalizeSettings(data.SiteSettings as Record<string, unknown> | undefined),
    sections,
  };
}
