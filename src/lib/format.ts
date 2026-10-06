import { DEFAULT_LANG, translate, type Lang, type MessageKey } from "./i18n.ts";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const MONTH_KEYS: MessageKey[] = [
  "month.1", "month.2", "month.3", "month.4", "month.5", "month.6",
  "month.7", "month.8", "month.9", "month.10", "month.11", "month.12",
];

function parseIsoDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export type DateStyle = "long" | "memo";

/**
 * "5 Agosto 2026" (long, on cards and document headings) or
 * "Agosto 5, 2026" (memo, the memorandum PETSA line). English reads
 * "5 August 2026" and "August 5, 2026".
 */
export function formatDateStyle(value: string, style: DateStyle, lang: Lang = DEFAULT_LANG): string {
  if (!value) return translate(lang, "date.none");
  const date = parseIsoDate(value);
  if (!date) return value;
  const month = translate(lang, MONTH_KEYS[date.getMonth()]);
  return style === "memo"
    ? `${month} ${date.getDate()}, ${date.getFullYear()}`
    : `${date.getDate()} ${month} ${date.getFullYear()}`;
}

export const formatDate = (value: string, lang: Lang = DEFAULT_LANG) => formatDateStyle(value, "long", lang);
export const formatMemoDate = (value: string, lang: Lang = DEFAULT_LANG) => formatDateStyle(value, "memo", lang);

/** Lets the browser re-format a date when the language changes. */
export function dateAttrs(value: string, style: DateStyle = "long"): Record<string, string> {
  return { "data-date": value, "data-date-style": style };
}

/** Only http(s) links survive; anything else becomes "". */
export function safeUrl(url: string | undefined | null): string {
  if (!url || url === "#") return "";
  try {
    const parsed = new URL(String(url).trim());
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

/**
 * Google Drive share links aren't directly embeddable; rewrite them to the
 * thumbnail endpoint. Every other http(s) URL is returned as-is.
 */
export function imageSourceUrl(url: string | undefined | null): string {
  const clean = safeUrl(url);
  if (!clean) return "";

  const fileMatch = clean.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
  if (fileMatch) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileMatch[1])}&sz=w1600`;
  }

  try {
    const parsed = new URL(clean);
    if (parsed.hostname.includes("drive.google.com")) {
      const id = parsed.searchParams.get("id");
      if (id) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1600`;
    }
  } catch {
    // safeUrl already validated it; nothing to rewrite.
  }

  return clean;
}
