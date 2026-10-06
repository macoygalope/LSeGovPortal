export const SECTIONS = [
  "Forms",
  "Announcements",
  "ExecutiveOrders",
  "Memorandums",
  "Resolutions",
] as const;

export type Section = (typeof SECTIONS)[number];

/** Sections that get an archive page and a page per document. */
export const DOCUMENT_SECTIONS = [
  "Announcements",
  "ExecutiveOrders",
  "Memorandums",
  "Resolutions",
] as const satisfies readonly Section[];

export type DocumentSection = (typeof DOCUMENT_SECTIONS)[number];

export interface EgovRecord {
  id: string;
  title: string;
  description: string;
  number: string;
  /** ISO date (YYYY-MM-DD) as entered in the admin; may be empty. */
  date: string;
  /** External link (Google Form, signed copy, ...). */
  url: string;
  image: string;
  icon: string;
  order: number;
  published: boolean;
  content: string;
  publicationYear: number;
  publicationSequence: number;
  publishedAt: string;

  // Announcements
  pinned: boolean;
  pinOrder: number;
  pinExpires: string;

  // Memorandums
  subject: string;
  memoTo: string;
  memoFrom: string;
  signatureImage: string;
  signatoryName: string;
  signatoryPosition: string;
}

export interface SiteSettings {
  siteTitle: string;
  siteSubtitle: string;
  heroTitle: string;
  heroDescription: string;
  heroImageUrl: string;
  logoUrl: string;
  mayorImageUrl: string;
  mayorName: string;
  meetingButtonLabel: string;
  meetingUrl: string;
  defaultDocumentImageUrl: string;
  defaultSignatureImageUrl: string;
  defaultSignatoryName: string;
  defaultSignatoryPosition: string;
  footerText: string;
}

export interface EgovData {
  settings: SiteSettings;
  sections: Record<Section, EgovRecord[]>;
}
