import type { DocumentSection, Section } from "./types.ts";

export interface SectionLabels {
  singular: string;
  plural: string;
  empty: string;
  searchEmpty: string;
  countSingular: string;
  countPlural: string;
  readAction: string;
  externalAction: string;
  noContent: string;
  defaultDescription: string;
}

const DOCUMENT_DEFAULTS = {
  countSingular: "dokumento",
  countPlural: "mga dokumento",
  readAction: "Basahin ang Buong Dokumento →",
  externalAction: "Buksan ang Nilagdaang Kopya ↗",
  noContent: "Wala pang buong nilalaman",
  defaultDescription: "Basahin ang buong dokumento para sa kumpletong detalye.",
};

export const LABELS: Record<Section, SectionLabels> = {
  Forms: {
    singular: "Online na Form",
    plural: "Mga Form",
    empty: "Wala pang form na nailalathala.",
    searchEmpty: "Walang form na tumutugma sa iyong paghahanap.",
    countSingular: "form",
    countPlural: "mga form",
    readAction: "Tingnan ang Detalye →",
    externalAction: "Buksan ang Form",
    noContent: "Wala pang nakatalang tagubilin",
    defaultDescription: "Basahin muna ang mga tagubilin bago buksan ang form.",
  },
  Announcements: {
    singular: "Anunsyo",
    plural: "Mga Anunsyo",
    empty: "Wala pang anunsyong nailalathala.",
    searchEmpty: "Walang anunsyong tumutugma sa iyong paghahanap.",
    countSingular: "anunsyo",
    countPlural: "mga anunsyo",
    readAction: "Basahin ang Buong Anunsyo →",
    externalAction: "Buksan ang Kaugnay na Link ↗",
    noContent: "Wala pang buong nilalaman",
    defaultDescription: "Basahin ang buong anunsyo para sa kumpletong detalye.",
  },
  ExecutiveOrders: {
    singular: "Executive Order",
    plural: "Executive Orders",
    empty: "Wala pang Executive Order na nailalathala.",
    searchEmpty: "Walang Executive Order na tumutugma sa iyong paghahanap.",
    ...DOCUMENT_DEFAULTS,
  },
  Memorandums: {
    singular: "Memorandum",
    plural: "Mga Memorandum",
    empty: "Wala pang memorandum na nailalathala.",
    searchEmpty: "Walang memorandum na tumutugma sa iyong paghahanap.",
    ...DOCUMENT_DEFAULTS,
  },
  Resolutions: {
    singular: "Resolusyon",
    plural: "Mga Resolusyon",
    empty: "Wala pang resolusyon na nailalathala.",
    searchEmpty: "Walang resolusyong tumutugma sa iyong paghahanap.",
    ...DOCUMENT_DEFAULTS,
  },
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

/** Page copy for each archive page. */
export const ARCHIVE_COPY: Record<
  DocumentSection,
  { eyebrow: string; heading: string; intro: string; searchLabel: string; searchPlaceholder: string }
> = {
  Announcements: {
    eyebrow: "Mula sa Tanggapan ng Punong Lungsod",
    heading: "Mga Anunsyo",
    intro: "Tingnan ang lahat ng opisyal na pabatid, proyekto, programa, at kaganapan ng Tanggapan ng Punong Lungsod.",
    searchLabel: "Maghanap ng anunsyo",
    searchPlaceholder: "Ilagay ang pamagat, proyekto, kaganapan, o salita…",
  },
  ExecutiveOrders: {
    eyebrow: "Tanggapan ng Punong Lungsod",
    heading: "Executive Orders",
    intro: "Mga opisyal na kautusang inilabas ng Punong Lungsod.",
    searchLabel: "Maghanap ng dokumento",
    searchPlaceholder: "Ilagay ang pamagat, numero, o salita…",
  },
  Memorandums: {
    eyebrow: "Mga Kautusang Administratibo",
    heading: "Mga Memorandum",
    intro: "Internal na talaan ng mga memorandum, tagubilin, at pabatid para sa mga ahensiya ng Pamahalaang Panglungsod.",
    searchLabel: "Maghanap ng dokumento",
    searchPlaceholder: "Ilagay ang pamagat, numero, o salita…",
  },
  Resolutions: {
    eyebrow: "Mga Pasya ng Pamahalaang Panglungsod",
    heading: "Mga Resolusyon",
    intro: "Mga pinagtibay na pasya, patakaran, at opisyal na pagpapasiya ng lungsod.",
    searchLabel: "Maghanap ng dokumento",
    searchPlaceholder: "Ilagay ang pamagat, numero, o salita…",
  },
};
