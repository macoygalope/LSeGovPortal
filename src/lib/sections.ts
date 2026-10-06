import type { MessageKey } from "./i18n.ts";
import type { DocumentSection, Section } from "./types.ts";

/** Text a section needs, as message keys (see messages/fil.ts and en.ts). */
export interface SectionLabels {
  singular: MessageKey;
  plural: MessageKey;
  empty: MessageKey;
  searchEmpty: MessageKey;
  countSingular: MessageKey;
  countPlural: MessageKey;
  readAction: MessageKey;
  externalAction: MessageKey;
  noContent: MessageKey;
  defaultDescription: MessageKey;
  back: MessageKey;
}

// Executive Orders, Memorandums and Resolutions share this wording.
const DOCUMENT_DEFAULTS = {
  countSingular: "doc.countSingular",
  countPlural: "doc.countPlural",
  readAction: "doc.readAction",
  externalAction: "doc.externalAction",
  noContent: "doc.noContent",
  defaultDescription: "doc.defaultDescription",
} as const satisfies Partial<SectionLabels>;

function ownLabels(section: Section) {
  return {
    singular: `section.${section}.singular`,
    plural: `section.${section}.plural`,
    empty: `section.${section}.empty`,
    searchEmpty: `section.${section}.searchEmpty`,
    back: `section.${section}.back`,
  } as const;
}

export const LABELS: Record<Section, SectionLabels> = {
  Forms: {
    ...ownLabels("Forms"),
    countSingular: "section.Forms.countSingular",
    countPlural: "section.Forms.countPlural",
    readAction: "section.Forms.readAction",
    externalAction: "section.Forms.externalAction",
    noContent: "section.Forms.noContent",
    defaultDescription: "section.Forms.defaultDescription",
  },
  Announcements: {
    ...ownLabels("Announcements"),
    countSingular: "section.Announcements.countSingular",
    countPlural: "section.Announcements.countPlural",
    readAction: "section.Announcements.readAction",
    externalAction: "section.Announcements.externalAction",
    noContent: "section.Announcements.noContent",
    defaultDescription: "section.Announcements.defaultDescription",
  },
  ExecutiveOrders: { ...ownLabels("ExecutiveOrders"), ...DOCUMENT_DEFAULTS },
  Memorandums: { ...ownLabels("Memorandums"), ...DOCUMENT_DEFAULTS },
  Resolutions: { ...ownLabels("Resolutions"), ...DOCUMENT_DEFAULTS },
};

/** URL segment each document section is served under. */
export const SECTION_ROUTE: Record<DocumentSection, string> = {
  Announcements: "announcements",
  ExecutiveOrders: "executive-orders",
  Memorandums: "memorandums",
  Resolutions: "resolutions",
};

export const ROUTE_SECTION = Object.fromEntries(
  Object.entries(SECTION_ROUTE).map(([section, route]) => [route, section]),
) as Record<string, DocumentSection>;

/** Page copy for each archive page, as message keys. */
export const ARCHIVE_COPY: Record<
  DocumentSection,
  { eyebrow: MessageKey; heading: MessageKey; intro: MessageKey; searchLabel: MessageKey; searchPlaceholder: MessageKey }
> = {
  Announcements: {
    eyebrow: "archive.Announcements.eyebrow",
    heading: "section.Announcements.plural",
    intro: "archive.Announcements.intro",
    searchLabel: "archive.Announcements.searchLabel",
    searchPlaceholder: "archive.Announcements.searchPlaceholder",
  },
  ExecutiveOrders: {
    eyebrow: "archive.ExecutiveOrders.eyebrow",
    heading: "section.ExecutiveOrders.plural",
    intro: "archive.ExecutiveOrders.intro",
    searchLabel: "archive.searchLabel",
    searchPlaceholder: "archive.searchPlaceholder",
  },
  Memorandums: {
    eyebrow: "archive.Memorandums.eyebrow",
    heading: "section.Memorandums.plural",
    intro: "archive.Memorandums.intro",
    searchLabel: "archive.searchLabel",
    searchPlaceholder: "archive.searchPlaceholder",
  },
  Resolutions: {
    eyebrow: "archive.Resolutions.eyebrow",
    heading: "section.Resolutions.plural",
    intro: "archive.Resolutions.intro",
    searchLabel: "archive.searchLabel",
    searchPlaceholder: "archive.searchPlaceholder",
  },
};
