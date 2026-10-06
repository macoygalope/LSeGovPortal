import type { EgovRecord } from "./types.ts";

export type SortMode = "newest" | "oldest" | "numberAsc" | "numberDesc";
export const SORT_MODES: readonly SortMode[] = ["newest", "oldest", "numberAsc", "numberDesc"];

/** Admin-assigned order first, then newest date. Mirrors the old `published()`. */
export function byAdminOrder(a: EgovRecord, b: EgovRecord): number {
  const orderDiff = a.order - b.order;
  if (orderDiff !== 0) return orderDiff;
  return b.date.localeCompare(a.date);
}

/**
 * Sequence within the series. Prefers the number the backend stored at
 * publish time and falls back to parsing it out of the printed number, which
 * is all older records have ("Blg. 07", "Blg. 2026-11").
 */
export function documentSequence(item: Pick<EgovRecord, "publicationSequence" | "number">): number {
  if (item.publicationSequence) return item.publicationSequence;
  const memoMatch = item.number.match(/(?:Blg\.?\s*)?\d{4}\s*[-–]\s*(\d+)/i);
  if (memoMatch) return Number(memoMatch[1]);
  // Live numbers are written both "Blg. 07" and "BLG.: 07"; allow the colon
  // (the old pattern didn't, so those records all sorted as sequence 0).
  const generalMatch = item.number.match(/Blg\.?[\s:]*(\d+)/i);
  return generalMatch ? Number(generalMatch[1]) : 0;
}

export function documentYear(
  item: Pick<EgovRecord, "publicationYear" | "number" | "date">,
): number {
  if (item.publicationYear) return item.publicationYear;
  const seriesMatch = item.number.match(/(?:Serye\s+ng\s+|Series\s+of\s+)(\d{4})/i);
  if (seriesMatch) return Number(seriesMatch[1]);
  const memoMatch = item.number.match(/(?:Blg\.?\s*)?(\d{4})\s*[-–]\s*\d+/i);
  if (memoMatch) return Number(memoMatch[1]);
  return Number(item.date.slice(0, 4)) || 0;
}

export function sortDocuments(items: readonly EgovRecord[], mode: SortMode = "newest"): EgovRecord[] {
  return [...items].sort((a, b) => {
    if (mode === "oldest") {
      const dateDiff = a.date.localeCompare(b.date);
      if (dateDiff !== 0) return dateDiff;
      return documentSequence(a) - documentSequence(b);
    }

    if (mode === "numberAsc" || mode === "numberDesc") {
      const direction = mode === "numberAsc" ? 1 : -1;
      const yearDiff = (documentYear(a) - documentYear(b)) * direction;
      if (yearDiff !== 0) return yearDiff;
      const sequenceDiff = (documentSequence(a) - documentSequence(b)) * direction;
      if (sequenceDiff !== 0) return sequenceDiff;
      return a.date.localeCompare(b.date) * direction;
    }

    const dateDiff = b.date.localeCompare(a.date);
    if (dateDiff !== 0) return dateDiff;
    const publishedDiff = b.publishedAt.localeCompare(a.publishedAt);
    if (publishedDiff !== 0) return publishedDiff;
    return documentSequence(b) - documentSequence(a);
  });
}

export const MAX_PINNED_ANNOUNCEMENTS = 3;

export function isPinnedAnnouncement(item: EgovRecord, todayIso: string): boolean {
  if (!item.pinned) return false;
  return !item.pinExpires || item.pinExpires >= todayIso;
}

export interface OrderedAnnouncement {
  item: EgovRecord;
  pinned: boolean;
}

/** Up to three active pins (by pin order), then everything else newest first. */
export function orderedAnnouncements(
  items: readonly EgovRecord[],
  todayIso: string,
): OrderedAnnouncement[] {
  const activePinned = items
    .filter((item) => isPinnedAnnouncement(item, todayIso))
    .sort((a, b) => {
      const pinDiff = a.pinOrder - b.pinOrder;
      if (pinDiff !== 0) return pinDiff;
      return b.date.localeCompare(a.date);
    })
    .slice(0, MAX_PINNED_ANNOUNCEMENTS);

  const pinnedIds = new Set(activePinned.map((item) => item.id));
  const regular = items
    .filter((item) => !pinnedIds.has(item.id))
    .sort((a, b) => b.date.localeCompare(a.date));

  return [
    ...activePinned.map((item) => ({ item, pinned: true })),
    ...regular.map((item) => ({ item, pinned: false })),
  ];
}

/** Local-time YYYY-MM-DD, matching how the admin enters pin expiry dates. */
export function localTodayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
