// What every page does once it has opened: fetch the content (live from
// lspd-backend, else the copy made at build time: lib/site-source.ts), put it in
// the page (markup from lib/render.ts) and wake the page's scripts. The page
// itself, built by Astro, is only the frame: header, footer, headings, and a
// place for each part of the content (see pages/ and components/Layout.astro).
//
// <body data-page="home|archive|document"> says which page this is.

import { localTodayIso } from "../lib/documents.ts";
import { settingKey, type MessageKey, type TranslatableSetting } from "../lib/i18n.ts";
import { isKiosk } from "../lib/kiosk.ts";
import {
  brandSeal,
  externalAction,
  heroImageStyle,
  mayorPhoto,
  renderArchive,
  renderDocumentPage,
  renderHome,
  type RenderContext,
} from "../lib/render.ts";
import { LABELS, ROUTE_SECTION, SECTION_ROUTE } from "../lib/sections.ts";
import { loadSiteData } from "../lib/site-source.ts";
import type { DocumentSection, EgovData, SiteSettings } from "../lib/types.ts";
import { withBase } from "../lib/url.ts";
import { initArchive } from "./archive.ts";
import { initFormViewer } from "./form-viewer.ts";
import { applyTranslations, t } from "./i18n.ts";

const base = import.meta.env.BASE_URL;
const ctx: RenderContext = { base, kiosk: isKiosk };

// Where to ask. The kiosk build is served by lspd-backend, so the site's own
// address is where its data is too (same origin: no CORS, nothing baked in). A
// build served from elsewhere names lspd-backend's site, or asks nothing and
// shows the copy made at build time.
const configured = (import.meta.env.PUBLIC_EGOV_DATA_URL ?? "").trim().replace(/\/+$/, "");
const liveBase = configured || (isKiosk ? base.replace(/\/+$/, "") : "");
const snapshotUrl = withBase("/assets/snapshot.json", base);

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);

function sectionFromRoute(route: string | null | undefined): DocumentSection | undefined {
  return route && Object.hasOwn(ROUTE_SECTION, route) ? ROUTE_SECTION[route] : undefined;
}

/** Text that is a site setting: follows the language only while it still holds the built-in default. */
function setSetting(element: HTMLElement, name: TranslatableSetting, value: string): void {
  element.textContent = value;
  const key = settingKey(name, value);
  if (key) element.dataset.i18n = key;
  else delete element.dataset.i18n;
  delete element.dataset.i18nVars;
}

function setHtml(selector: string, html: string): void {
  const element = $(selector);
  if (element) element.innerHTML = html;
}

/** The parts of every page that come from the settings: title, subtitle, seal, footer. */
function applyChrome(settings: SiteSettings): void {
  document.querySelectorAll<HTMLElement>("[data-site-title]").forEach((element) => {
    element.textContent = settings.siteTitle;
  });
  document.querySelectorAll<HTMLElement>("a.brand[aria-label]").forEach((element) => {
    element.setAttribute("aria-label", settings.siteTitle);
  });
  document.querySelectorAll<HTMLElement>("[data-site-subtitle]").forEach((element) => {
    setSetting(element, "siteSubtitle", settings.siteSubtitle);
  });
  document.querySelectorAll<HTMLElement>("[data-site-footer]").forEach((element) => {
    setSetting(element, "footerText", settings.footerText);
  });
  document.querySelectorAll<HTMLElement>("[data-brand-seal]").forEach((element) => {
    element.outerHTML = brandSeal(settings.logoUrl);
  });

  const title = $("title");
  if (title) {
    title.dataset.titleSuffix = settings.siteTitle;
    if (title.dataset.titleKey) document.title = `${t(title.dataset.titleKey as MessageKey)} — ${settings.siteTitle}`;
    else if (!title.dataset.titleName) document.title = settings.siteTitle;
  }
}

function applyHero(settings: SiteSettings): void {
  const hero = $("#heroSection");
  if (hero) {
    const style = heroImageStyle(settings.heroImageUrl);
    hero.classList.toggle("has-custom-image", Boolean(style));
    if (style) hero.style.setProperty("--hero-image", style.slice("--hero-image: ".length));
    else hero.style.removeProperty("--hero-image");
  }

  const title = $("[data-hero-title]");
  if (title) setSetting(title, "heroTitle", settings.heroTitle);
  const description = $("[data-hero-description]");
  if (description) setSetting(description, "heroDescription", settings.heroDescription);
  const name = $("[data-mayor-name]");
  if (name) name.textContent = settings.mayorName;
  setHtml("[data-mayor-photo]", mayorPhoto(settings.mayorImageUrl));

  setHtml(
    "[data-meeting-action]",
    externalAction(ctx, {
      url: settings.meetingUrl,
      label: settings.meetingButtonLabel,
      labelKey: settingKey("meetingButtonLabel", settings.meetingButtonLabel),
      variant: "primary",
    }),
  );
}

function showHome(data: EgovData): void {
  const html = renderHome(ctx, data, localTodayIso());
  setHtml("#formsGrid", html.forms);
  setHtml("#announcementGrid", html.announcements);
  setHtml("#executiveGrid", html.executiveOrders);
  setHtml("#resolutionGrid", html.resolutions);
  for (const [id, count] of Object.entries(html.counts)) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(count);
  }
  applyHero(data.settings);
  initFormViewer(data.sections.Forms, ctx);
}

function showArchive(data: EgovData): void {
  const section = sectionFromRoute(document.body.dataset.section);
  const root = $("[data-archive]");
  const empty = root?.querySelector("[data-archive-empty]");
  if (!section || !root || !empty) return;
  const { cards } = renderArchive(ctx, section, data, localTodayIso(), Number(root.dataset.pageSize) || 9);
  empty.insertAdjacentHTML("beforebegin", cards);
  initArchive(root);
}

function showDocument(data: EgovData): void {
  const params = new URLSearchParams(window.location.search);
  const section = sectionFromRoute(params.get("section"));
  const id = params.get("id");
  // A page exists only for a record that has body text; one with just a link
  // opens that link from its card.
  const item = section && id ? data.sections[section].find((record) => record.id === id && record.content !== "") : undefined;
  const main = $("#documentMain");
  if (!main) return;

  if (!section || !item) {
    const back: MessageKey = section ? LABELS[section].back : "archive.back";
    const href = withBase(section ? `/${SECTION_ROUTE[section]}/` : "/", base);
    main.innerHTML = `<div class="container"><div class="empty-state" data-i18n="doc.notFound"></div>
<p><a class="button button-secondary button-small" href="${href}" data-i18n="${back}"></a></p></div>`;
    return;
  }

  const page = renderDocumentPage(ctx, section, item, data.settings);
  main.innerHTML = page.html;
  const title = $("title");
  if (title) {
    if (page.titleKey) title.dataset.titleKey = page.titleKey;
    else delete title.dataset.titleKey;
    title.dataset.titleName = page.title;
    document.title = `${page.title} — ${data.settings.siteTitle}`;
  }
  if (section === "Memorandums") {
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex,nofollow";
    document.head.append(robots);
  }
}

function showStatus(state: "loading" | "error"): void {
  const status = $("[data-load-status]");
  if (!status) return;
  status.hidden = false;
  status.className = state === "error" ? "error-state" : "empty-state";
  status.innerHTML =
    state === "error"
      ? `<span data-i18n="load.error"></span> <button class="button button-secondary button-small" type="button" data-retry data-i18n="load.retry"></button>`
      : `<span data-i18n="load.loading"></span>`;
  applyTranslations(status);
}

async function run(): Promise<void> {
  showStatus("loading");
  let loaded;
  try {
    loaded = await loadSiteData({ liveBase, snapshotUrl });
  } catch (error) {
    console.error(`[egov] ${error instanceof Error ? error.message : error}`);
    document.body.dataset.state = "error";
    showStatus("error");
    return;
  }

  document.body.dataset.source = loaded.source;
  const { data } = loaded;
  applyChrome(data.settings);
  switch (document.body.dataset.page) {
    case "home":
      showHome(data);
      break;
    case "archive":
      showArchive(data);
      break;
    case "document":
      showDocument(data);
      break;
  }

  const status = $("[data-load-status]");
  if (status) status.hidden = true;
  document.body.dataset.state = "ready";
  // Everything just added is in the default language; match the chosen one.
  applyTranslations(document);
}

// A picture that fails to load is dropped, which leaves the symbol under it.
document.addEventListener(
  "error",
  (event) => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.parentElement?.classList.contains("card-media")) {
      image.parentElement.classList.add("image-error");
      image.remove();
    }
  },
  true,
);

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("[data-retry]")) void run();
  if (target.closest("[data-print]")) window.print();
});

if (document.body.dataset.page) void run();
