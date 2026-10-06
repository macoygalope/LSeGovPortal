export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const MONTHS = [
  "Enero", "Pebrero", "Marso", "Abril", "Mayo", "Hunyo",
  "Hulyo", "Agosto", "Setyembre", "Oktubre", "Nobyembre", "Disyembre",
];

function parseIsoDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "5 Agosto 2026" — used on cards and document headings. */
export function formatDate(value: string): string {
  if (!value) return "Walang nakatalang petsa";
  const date = parseIsoDate(value);
  if (!date) return value;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "Agosto 5, 2026" — the memorandum PETSA line. */
export function formatMemoDate(value: string): string {
  if (!value) return "Walang nakatalang petsa";
  const date = parseIsoDate(value);
  if (!date) return value;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
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
