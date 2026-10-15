import { archiveEntries, byAdminOrder, orderedAnnouncements, sortDocuments, type ArchiveEntry } from "./documents.ts";
import { dateAttrs, escapeHtml, formatDate, formatMemoDate, imageSourceUrl, safeUrl } from "./format.ts";
import { i18n, i18nAttr, settingI18n, t, type MessageKey, type MessageVars } from "./i18n.ts";
import { documentContentToHtml } from "./markdown.ts";
import { LABELS, SECTION_ROUTE } from "./sections.ts";
import type { DocumentSection, EgovData, EgovRecord, SiteSettings } from "./types.ts";
import { withBase } from "./url.ts";

// The pages' dynamic markup as strings. Every page used to be built by Astro
// components from the database at build time; the content now arrives in the
// browser, so the same markup is made here, from the same data, by the page
// itself. It is the Astro components' output, class for class, so the styles
// and scripts (archive.ts, form-viewer.ts, i18n.ts) need no change.
//
// Everything that comes from the database goes through escapeHtml; links and
// pictures through safeUrl / imageSourceUrl, which keep http(s) only. Text the
// interface supplies is in the default language and carries data-i18n*
// attributes, which scripts/i18n.ts translates once it is in the page.
//
// No import.meta.env here: what differs per build (the base path, the kiosk) is
// passed in, so this runs unchanged under Node's test runner.

export interface RenderContext {
  /** The site's base path, "/" or "/api/v1/websites/egov/". */
  base: string;
  /** The kiosk build: nothing links out, and nothing prints. */
  kiosk: boolean;
}

const esc = escapeHtml;

type AttrValue = string | number | undefined;

/** ` name="value"` for each value that is set, escaped. */
function attrs(values: Record<string, AttrValue>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${esc(value)}"`)
    .join("");
}

/** ` data-i18n="key"` (and its vars): the element's text follows the chosen language. */
const ti = (key: MessageKey, vars?: MessageVars): string => attrs(i18n(key, vars));
/** The same for attributes: ` data-i18n-attr="alt:key"`. */
const tiAttr = (map: Record<string, MessageKey>, vars?: MessageVars): string => attrs(i18nAttr(map, vars));

export function emptyState(key: MessageKey): string {
  return `<div class="empty-state"${ti(key)}>${esc(t(key))}</div>`;
}

/** The round seal in the header and footer: the uploaded logo, else "LS". */
export function brandSeal(logoUrl: string): string {
  const logo = imageSourceUrl(logoUrl);
  return logo
    ? `<span class="brand-seal has-image" data-brand-seal aria-hidden="true"><img src="${esc(logo)}" alt="${esc(t("brand.sealAlt"))}"${tiAttr({ alt: "brand.sealAlt" })}></span>`
    : `<span class="brand-seal" data-brand-seal aria-hidden="true">LS</span>`;
}

/** Card header: the entry's image (or a fallback image), else its emoji icon. */
export function cardMedia(options: { image: string; fallbackImage?: string; icon: string; fallbackIcon?: string }): string {
  const { image, fallbackImage = "", icon, fallbackIcon = "📄" } = options;
  const src = imageSourceUrl(image || fallbackImage);
  const symbol = esc(icon || fallbackIcon);
  // A picture that fails to load is dropped by egov-page.ts, which leaves the symbol.
  return src
    ? `<div class="card-media"><img src="${esc(src)}" alt="" loading="lazy"><span>${symbol}</span></div>`
    : `<div class="card-media image-error"><span>${symbol}</span></div>`;
}

export interface ExternalActionOptions {
  url: string;
  /** Text written by staff (a custom button label); shown as written. */
  label?: string;
  /** Interface text that follows the chosen language. Wins over `label`. */
  labelKey?: MessageKey;
  /** "link" = plain text link (cards); "primary" / "secondary" = buttons. */
  variant?: "link" | "primary" | "secondary";
  /** What the disabled kiosk placeholder says. */
  placeholderKey?: MessageKey;
  id?: string;
}

/**
 * A link out (Google Form, booking calendar, signed copy). On the kiosk it is
 * a disabled placeholder instead, since a kiosk screen cannot be assumed to
 * open external sites.
 */
export function externalAction(ctx: RenderContext, options: ExternalActionOptions): string {
  const { url, label = "", labelKey, variant = "link", placeholderKey = "kiosk.unavailable", id } = options;
  const href = safeUrl(url);
  if (!href) return "";

  const idAttr = attrs({ id });
  if (ctx.kiosk) {
    const placeholder = esc(t(placeholderKey));
    return variant === "link"
      ? `<span class="external-placeholder"${idAttr}${ti(placeholderKey)}>${placeholder}</span>`
      : `<span class="button button-${variant} is-disabled"${idAttr} aria-disabled="true"${ti(placeholderKey)}>${placeholder}</span>`;
  }
  const classAttr = variant === "link" ? "" : ` class="button button-${variant}"`;
  const text = labelKey ? t(labelKey) : label;
  return `<a${classAttr}${idAttr} href="${esc(href)}" target="_blank" rel="noopener noreferrer"${labelKey ? ti(labelKey) : ""}>${esc(text)}</a>`;
}

/** Where a document's own page is: one page for all of them, which reads the section and id. */
export function documentHref(ctx: RenderContext, section: DocumentSection, id: string): string {
  return `${withBase("/document/", ctx.base)}?section=${SECTION_ROUTE[section]}&id=${encodeURIComponent(id)}`;
}

export interface DocumentCardOptions {
  fallbackImage?: string;
  pinned?: boolean;
  /** Per-sort-mode position, used by the archive page's sort. */
  ranks?: Record<string, number>;
  /** Initial position, used by the archive page's paging. */
  position?: number;
  hidden?: boolean;
}

export function documentCard(
  ctx: RenderContext,
  item: EgovRecord,
  section: DocumentSection,
  options: DocumentCardOptions = {},
): string {
  const { fallbackImage = "", pinned = false, ranks, position, hidden = false } = options;
  const label = LABELS[section];
  const hasPage = item.content !== "";
  const searchText = `${item.title} ${item.description} ${item.number} ${item.content}`.toLowerCase();

  const classes = ["document-card", pinned ? "pinned-announcement" : "", hidden ? "hidden" : ""].filter(Boolean).join(" ");
  // HTML lowercases attribute names, so the sort mode is lowercased here and
  // again in scripts/archive.ts when it reads the rank back.
  const rankAttrs = ranks
    ? Object.entries(ranks).map(([mode, rank]) => ` data-rank-${mode.toLowerCase()}="${esc(rank)}"`).join("")
    : "";
  const cardAttrs = (ranks ? ` data-card="" data-search="${esc(searchText)}"` : "") + attrs({ "data-position": position });

  const open = hasPage
    ? `<a class="document-open-button" href="${esc(documentHref(ctx, section, item.id))}"${ti(label.readAction)}>${esc(t(label.readAction))}</a>`
    : item.url
      ? externalAction(ctx, { url: item.url, labelKey: label.externalAction })
      : `<span class="no-file"${ti(label.noContent)}>${esc(t(label.noContent))}</span>`;

  return `<article class="${classes}"${cardAttrs}${rankAttrs}>
  ${cardMedia({ image: item.image, fallbackImage, icon: item.icon })}
  <div class="document-card-body">
    <div class="document-topline">
      <span class="document-badge"${ti(label.singular)}>${esc(t(label.singular))}</span>${pinned ? `<span class="announcement-pin-badge"${ti("doc.pinnedBadge")}>${esc(t("doc.pinnedBadge"))}</span>` : ""}
    </div>
    <p class="document-number"${item.number ? "" : ti(label.singular)}>${esc(item.number || t(label.singular))}</p>
    <h3>${esc(item.title)}</h3>
    <p${item.description ? "" : ti(label.defaultDescription)}>${esc(item.description || t(label.defaultDescription))}</p>
    <div class="document-meta">
      <span${attrs(dateAttrs(item.date))}>${esc(formatDate(item.date))}</span>
      ${open}
    </div>
  </div>
</article>`;
}

/** A form's card on the home page: it opens the instructions pop-out. */
export function formCard(form: EgovRecord): string {
  const aria = t("home.forms.cardAria", { title: form.title });
  return `<button class="form-card form-card-button" type="button" data-open-form data-id="${esc(form.id)}" aria-label="${esc(aria)}"${tiAttr({ "aria-label": "home.forms.cardAria" }, { title: form.title })}>
  ${cardMedia({ image: form.image, icon: form.icon })}
  <div class="form-card-body">
    <h3>${esc(form.title)}</h3>
    <p${form.description ? "" : ti("home.forms.cardDefault")}>${esc(form.description || t("home.forms.cardDefault"))}</p>
    <span class="card-link"${ti(LABELS.Forms.readAction)}>${esc(t(LABELS.Forms.readAction))}</span>
  </div>
</button>`;
}

export interface HomeHtml {
  forms: string;
  announcements: string;
  executiveOrders: string;
  resolutions: string;
  /** The number under each heading at the top, by the id of the element that shows it. */
  counts: Record<"formsCount" | "announcementCount" | "ordersCount" | "documentsCount", number>;
}

/** The home page's forms and the latest three of each kind of document. */
export function renderHome(ctx: RenderContext, data: EgovData, todayIso: string): HomeHtml {
  const { settings, sections } = data;
  const forms = [...sections.Forms].sort(byAdminOrder);
  const announcements = orderedAnnouncements(sections.Announcements, todayIso).slice(0, 3);
  const executiveOrders = sortDocuments(sections.ExecutiveOrders).slice(0, 3);
  const resolutions = sortDocuments(sections.Resolutions).slice(0, 3);
  const fallbackImage = settings.defaultDocumentImageUrl;

  return {
    forms: forms.length ? forms.map(formCard).join("\n") : emptyState("home.forms.empty"),
    announcements: announcements.length
      ? announcements.map(({ item, pinned }) => documentCard(ctx, item, "Announcements", { pinned })).join("\n")
      : emptyState(LABELS.Announcements.empty),
    executiveOrders: executiveOrders.length
      ? executiveOrders.map((item) => documentCard(ctx, item, "ExecutiveOrders", { fallbackImage })).join("\n")
      : emptyState(LABELS.ExecutiveOrders.empty),
    resolutions: resolutions.length
      ? resolutions.map((item) => documentCard(ctx, item, "Resolutions", { fallbackImage })).join("\n")
      : emptyState(LABELS.Resolutions.empty),
    counts: {
      formsCount: sections.Forms.length,
      announcementCount: sections.Announcements.length,
      ordersCount: sections.ExecutiveOrders.length,
      documentsCount: sections.Resolutions.length,
    },
  };
}

export interface ArchiveHtml {
  /** Every card, the first `pageSize` visible; the page's script shows the rest a page at a time. */
  cards: string;
  total: number;
  entries: ArchiveEntry[];
}

export function renderArchive(
  ctx: RenderContext,
  section: DocumentSection,
  data: EgovData,
  todayIso: string,
  pageSize: number,
): ArchiveHtml {
  const entries = archiveEntries(section, data.sections[section], todayIso);
  const fallbackImage = data.settings.defaultDocumentImageUrl;
  const cards = entries
    .map(({ item, pinned, ranks }, index) =>
      documentCard(ctx, item, section, { fallbackImage, pinned, ranks, position: index, hidden: index >= pageSize }),
    )
    .join("\n");
  return { cards, total: entries.length, entries };
}

export interface DocumentPageHtml {
  /** The whole of <main>: the toolbar and the document. */
  html: string;
  /** The tab title: staff's own words, or, when there are none, the kind of document (follows the language). */
  title: string;
  titleKey?: MessageKey;
}

/** One document's page. Records with no body text have none: they link out from their card. */
export function renderDocumentPage(
  ctx: RenderContext,
  section: DocumentSection,
  item: EgovRecord,
  settings: SiteSettings,
): DocumentPageHtml {
  const label = LABELS[section];
  const isMemo = section === "Memorandums";
  const archiveHref = withBase(`/${SECTION_ROUTE[section]}/`, ctx.base);
  const body = documentContentToHtml(item.content, { links: !ctx.kiosk });

  const cover = imageSourceUrl(item.image || settings.defaultDocumentImageUrl);
  // Memorandum-only: the global "default document image" is the letterhead for
  // every memorandum, and the signature falls back to the site-wide default.
  const letterhead = isMemo ? imageSourceUrl(settings.defaultDocumentImageUrl) : "";
  const signature = isMemo ? imageSourceUrl(item.signatureImage || settings.defaultSignatureImageUrl) : "";
  const signatoryName = item.signatoryName || settings.defaultSignatoryName || settings.mayorName;
  const signatoryPosition = item.signatoryPosition || settings.defaultSignatoryPosition;

  // Titles written by staff are shown as written; only the fallbacks used when
  // they are missing follow the chosen language.
  const pageTitle = isMemo ? item.number : item.title;

  const toolbar = `<div class="container memorandum-toolbar">
  <a class="button button-secondary button-small" href="${esc(archiveHref)}"${ti(label.back)}>${esc(t(label.back))}</a>
  <div class="memorandum-toolbar-actions">
    ${externalAction(ctx, { url: item.url, labelKey: label.externalAction, variant: "secondary" })}
    ${ctx.kiosk ? "" : `<button class="button button-primary button-small" type="button" data-print${ti("doc.print")}>${esc(t("doc.print"))}</button>`}
  </div>
</div>`;

  let article: string;
  if (isMemo) {
    const memoRows = [
      { label: "memo.to", value: item.memoTo, fallback: "memo.toDefault" },
      { label: "memo.from", value: item.memoFrom, fallback: "memo.fromDefault" },
      { label: "memo.subject", value: item.subject || item.title, fallback: "section.Memorandums.singular" },
    ] as const satisfies { label: MessageKey; value: string; fallback: MessageKey }[];

    const rows = memoRows
      .map(
        (row) => `<div class="memorandum-meta-row">
      <span class="memorandum-meta-label"${ti(row.label)}>${esc(t(row.label))}</span>
      <span class="memorandum-meta-colon">:</span>
      <strong${row.value ? "" : ti(row.fallback)}>${esc(row.value || t(row.fallback))}</strong>
    </div>`,
      )
      .join("\n    ");

    article = `<article class="official-document memorandum-document">
  ${letterhead ? `<img class="memorandum-letterhead" src="${esc(letterhead)}" alt="${esc(t("memo.letterheadAlt"))}"${tiAttr({ alt: "memo.letterheadAlt" })}>` : ""}
  <header class="memorandum-heading">
    <span class="eyebrow"${ti("memo.eyebrow")}>${esc(t("memo.eyebrow"))}</span>
    <h1>${esc(item.number || "MEMORANDUM")}</h1>
  </header>
  <div class="memorandum-meta" aria-label="${esc(t("memo.detailsAria"))}"${tiAttr({ "aria-label": "memo.detailsAria" })}>
    ${rows}
    <div class="memorandum-meta-row">
      <span class="memorandum-meta-label"${ti("memo.date")}>${esc(t("memo.date"))}</span>
      <span class="memorandum-meta-colon">:</span>
      <strong${attrs(dateAttrs(item.date, "memo"))}>${esc(formatMemoDate(item.date))}</strong>
    </div>
  </div>
  <div class="memorandum-body official-document-body">${body}</div>
  <footer class="memorandum-document-footer">
    <div class="memorandum-signature-block">
      ${signature ? `<img class="memorandum-signature-image" src="${esc(signature)}" alt="${esc(t("memo.signatureAlt"))}"${tiAttr({ alt: "memo.signatureAlt" })}>` : ""}
      <strong class="memorandum-signatory-name">${esc(signatoryName)}</strong>
      <span class="memorandum-signatory-position"${item.signatoryPosition ? "" : attrs(settingI18n("defaultSignatoryPosition", signatoryPosition))}>${esc(signatoryPosition)}</span>
    </div>
  </footer>
</article>`;
  } else {
    article = `<article class="official-document memorandum-document">
  ${cover ? `<img class="official-document-cover" src="${esc(cover)}" alt="">` : ""}
  <div class="official-document-heading">
    <span class="eyebrow"${item.number ? "" : ti(label.singular)}>${esc(item.number || t(label.singular))}</span>
    <h2>${esc(item.title)}</h2>
    <p${attrs(dateAttrs(item.date))}>${esc(formatDate(item.date))}</p>
  </div>
  <div class="official-document-body">${body}</div>
  <div class="official-document-footer">
    <p>
      <span${ti("home.mayorOffice")}>${esc(t("home.mayorOffice"))}</span><br>
      <strong>${esc(settings.mayorName)}</strong>
    </p>
  </div>
</article>`;
  }

  return {
    html: `${toolbar}\n<section class="memorandum-reader-stage">\n${article}\n</section>`,
    title: pageTitle || t(label.singular),
    titleKey: pageTitle ? undefined : label.singular,
  };
}

/** What opens when a form's card is clicked: its instructions, then the link out. */
export function renderFormDialog(ctx: RenderContext, form: EgovRecord): string {
  const cover = imageSourceUrl(form.image);
  const content = documentContentToHtml(form.content || form.description, {
    links: !ctx.kiosk,
    emptyKey: "viewer.defaultBody",
  });
  return `${
    cover
      ? `<img class="official-document-cover" src="${esc(cover)}" alt="${esc(t("viewer.coverAlt", { title: form.title }))}"${tiAttr({ alt: "viewer.coverAlt" }, { title: form.title })}>`
      : ""
  }
<div class="official-document-heading">
  <span class="eyebrow"${ti("viewer.eyebrow")}>${esc(t("viewer.eyebrow"))}</span>
  <h2 id="viewerTitle">${esc(form.title)}</h2>
</div>
<div class="official-document-body">${content}</div>
${ctx.kiosk ? "<div data-citizen-scan-slot></div>" : ""}
<div class="official-document-footer">
  ${
    ctx.kiosk && form.url
      ? `<p class="external-placeholder-note"${ti("viewer.kioskNote")}>${esc(t("viewer.kioskNote"))}</p>`
      : ""
  }
  ${externalAction(ctx, {
    id: "viewerExternalLink",
    url: form.url,
    labelKey: LABELS.Forms.externalAction,
    variant: "primary",
    placeholderKey: "kiosk.comingSoon",
  })}
</div>`;
}

/** The mayor's picture on the home page's hero panel, or the building when there is none. */
export function mayorPhoto(mayorImageUrl: string): string {
  const image = imageSourceUrl(mayorImageUrl);
  return image
    ? `<img id="mayorImage" class="mayor-photo" src="${esc(image)}" alt="${esc(t("home.mayorAlt"))}"${tiAttr({ alt: "home.mayorAlt" })}>`
    : `<div class="hero-panel-icon">🏛️</div>`;
}

/** The hero's own picture as a CSS custom property value, or "" for the default look. */
export function heroImageStyle(heroImageUrl: string): string {
  const image = imageSourceUrl(heroImageUrl);
  return image ? `--hero-image: url("${image.replaceAll('"', "%22")}")` : "";
}
