import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { normalizePayload, normalizeRecord, DEFAULT_SETTINGS } from "./normalize.ts";
import {
  brandSeal,
  cardMedia,
  documentCard,
  documentHref,
  externalAction,
  formCard,
  heroImageStyle,
  mayorPhoto,
  renderArchive,
  renderDocumentPage,
  renderFormDialog,
  renderHome,
  type RenderContext,
} from "./render.ts";
import type { EgovRecord } from "./types.ts";

const web: RenderContext = { base: "/", kiosk: false };
const kiosk: RenderContext = { base: "/api/v1/websites/egov/", kiosk: true };

const live = normalizePayload(JSON.parse(readFileSync("fixtures/live-all.json", "utf8")));
const record = (overrides: Partial<EgovRecord> & Record<string, unknown>): EgovRecord =>
  normalizeRecord({ id: "x", title: "T", published: true, ...overrides });

/** The markup with every quoted attribute value emptied, so what is left is the tags and attribute names alone. */
const skeleton = (html: string): string => html.replace(/="[^"]*"/g, '=""');

/** Only the tags of `html`, with their values emptied: where an attribute or element could be injected, and nowhere text is. */
const tags = (html: string): string => (skeleton(html).match(/<[^>]*>/g) ?? []).join("");

/** The value of every href and src in `html`, as written (still escaped). */
const addresses = (html: string): string[] => [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]!);

describe("what staff type is shown, never run", () => {
  const hostile = record({
    title: `"><img src=x onerror=alert(1)>`,
    description: "<script>alert(2)</script>",
    number: "<b>1</b>",
    icon: "<svg onload=alert(3)>",
    content: "text",
    image: "javascript:alert(4)",
  });

  it("escapes every field of a card", () => {
    const html = documentCard(web, hostile, "ExecutiveOrders");
    assert.ok(!/<img |<script|<svg|<b>/.test(html), html);
    assert.ok(html.includes("&lt;script&gt;alert(2)&lt;/script&gt;"));
    // The only tags are the card's own.
    assert.deepEqual([...html.matchAll(/<(\w+)/g)].map((m) => m[1]).filter((t) => !["article", "div", "span", "p", "h3", "a", "img"].includes(t!)), []);
  });

  it("keeps a bad picture address out of src", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///c:/x.png", "//evil.example/x.png", "vbscript:x"]) {
      const html = cardMedia({ image: bad, icon: "📄" });
      assert.ok(!html.includes("<img"), `${bad} -> ${html}`);
      assert.ok(html.includes("image-error"));
    }
    assert.ok(cardMedia({ image: "https://img.example/a.png", icon: "" }).includes('src="https://img.example/a.png"'));
  });

  it("keeps a bad link out of href, and a kiosk links nowhere at all", () => {
    for (const bad of ["javascript:alert(1)", "data:x", "ftp://x/y", "#", ""]) {
      assert.equal(externalAction(web, { url: bad, labelKey: "doc.externalAction" }), "", bad);
    }
    const link = externalAction(web, { url: "https://example.com/a?b=1&c=2", labelKey: "doc.externalAction" });
    assert.match(link, /href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer"/);
    const onKiosk = externalAction(kiosk, { url: "https://example.com/a", labelKey: "doc.externalAction" });
    assert.ok(!onKiosk.includes("href") && onKiosk.includes("external-placeholder"), onKiosk);
  });

  it("puts no event handler, script or javascript: address in any page it makes", () => {
    const item = record({ ...hostile, content: "<script>x</script> [l](javascript:alert(1)) [ok](https://example.com)", url: "javascript:x" });
    const data = { settings: { ...DEFAULT_SETTINGS, mayorImageUrl: "javascript:1", heroImageUrl: "javascript:2", logoUrl: "javascript:3" }, sections: { ...live.sections, Announcements: [item], Memorandums: [item], Forms: [item] } };
    const parts = [
      ...Object.values(renderHome(web, data, "2026-01-01")).filter((v) => typeof v === "string"),
      renderArchive(web, "Announcements", data, "2026-01-01", 9).cards,
      renderDocumentPage(web, "Memorandums", item, data.settings).html,
      renderDocumentPage(web, "Announcements", item, data.settings).html,
      renderFormDialog(web, item),
      renderFormDialog(kiosk, item),
      mayorPhoto(data.settings.mayorImageUrl),
      brandSeal(data.settings.logoUrl),
    ] as string[];
    for (const html of parts) {
      // No script element and no event-handler attribute, once the quoted values (where staff's text may sit, escaped) are set aside...
      assert.ok(!/<script|\son\w+=/i.test(tags(html)), tags(html).slice(0, 300));
      // ...and every address a page points at is http(s) or the site's own.
      for (const address of addresses(html)) assert.match(address, /^(https?:\/\/|\/|#)/, address);
    }
    assert.equal(heroImageStyle("javascript:2"), "");
  });
});

describe("document cards", () => {
  const order = record({ id: "eo-1", title: "Order", number: "Blg. 07", date: "2026-03-05", content: "body", description: "d" });

  it("link to the one page every document shares, with the section and id in the address", () => {
    assert.equal(documentHref(kiosk, "ExecutiveOrders", "eo-1"), "/api/v1/websites/egov/document/?section=executive-orders&id=eo-1");
    assert.equal(documentHref(web, "Announcements", "a b/c&d"), "/document/?section=announcements&id=a%20b%2Fc%26d");
    const html = documentCard(kiosk, order, "ExecutiveOrders");
    assert.ok(html.includes('href="/api/v1/websites/egov/document/?section=executive-orders&amp;id=eo-1"'), html);
  });

  it("carry the ranks, the search text and the position the archive script reads", () => {
    const html = documentCard(web, order, "ExecutiveOrders", { ranks: { newest: 0, numberAsc: 4 }, position: 3, hidden: true });
    assert.match(html, /<article class="document-card hidden" data-card="" data-search="order d blg\. 07 body" data-position="3" data-rank-newest="0" data-rank-numberasc="4">/);
  });

  it("have none of them outside an archive", () => {
    const html = documentCard(web, order, "ExecutiveOrders");
    assert.ok(!/data-card|data-search|data-rank|data-position/.test(html));
  });

  it("mark a pinned announcement", () => {
    const html = documentCard(web, order, "Announcements", { pinned: true });
    assert.ok(html.includes("pinned-announcement") && html.includes("announcement-pin-badge"));
    assert.ok(!documentCard(web, order, "Announcements").includes("announcement-pin-badge"));
  });

  it("open a document's page if it has text, else link out, else say there is nothing", () => {
    assert.ok(documentCard(web, order, "ExecutiveOrders").includes("document-open-button"));
    const linkOnly = record({ title: "L", url: "https://example.com/signed.pdf" });
    assert.ok(documentCard(web, linkOnly, "ExecutiveOrders").includes('href="https://example.com/signed.pdf"'));
    assert.ok(documentCard(kiosk, linkOnly, "ExecutiveOrders").includes("external-placeholder"));
    assert.ok(documentCard(web, record({ title: "N" }), "ExecutiveOrders").includes('class="no-file"'));
  });

  it("fall back to the section's own words, translatably, for what is missing", () => {
    const html = documentCard(web, record({ title: "Bare" }), "Resolutions");
    assert.ok(html.includes('data-i18n="section.Resolutions.singular"'));
    assert.ok(html.includes('data-i18n="doc.defaultDescription"'));
    assert.ok(html.includes('data-date="" data-date-style="long"'));
  });

  it("use the default picture when the entry has none, and its icon when neither loads", () => {
    assert.ok(documentCard(web, record({ title: "P" }), "Resolutions", { fallbackImage: "https://img.example/d.png" }).includes('src="https://img.example/d.png"'));
    assert.ok(cardMedia({ image: "", icon: "🏛️" }).includes("<span>🏛️</span>"));
    assert.ok(cardMedia({ image: "", icon: "" }).includes("<span>📄</span>"));
  });
});

describe("the home page's parts", () => {
  const home = renderHome(kiosk, live, "2026-10-15");

  it("count what is published, as the page always did", () => {
    assert.deepEqual(home.counts, {
      formsCount: live.sections.Forms.length,
      announcementCount: live.sections.Announcements.length,
      ordersCount: live.sections.ExecutiveOrders.length,
      documentsCount: live.sections.Resolutions.length,
    });
  });

  it("show every form, and the latest three of each kind", () => {
    assert.equal((home.forms.match(/class="form-card /g) ?? []).length, live.sections.Forms.length);
    assert.equal((home.announcements.match(/<article /g) ?? []).length, 3);
    assert.equal((home.executiveOrders.match(/<article /g) ?? []).length, 3);
    assert.equal((home.resolutions.match(/<article /g) ?? []).length, Math.min(3, live.sections.Resolutions.length));
  });

  it("say so when there is nothing", () => {
    const empty = renderHome(web, { settings: DEFAULT_SETTINGS, sections: { Forms: [], Announcements: [], ExecutiveOrders: [], Memorandums: [], Resolutions: [] } }, "2026-10-15");
    assert.match(empty.forms, /^<div class="empty-state" data-i18n="home.forms.empty">/);
    assert.match(empty.executiveOrders, /data-i18n="section.ExecutiveOrders.empty"/);
    assert.deepEqual(Object.values(empty.counts), [0, 0, 0, 0]);
  });

  it("put a pinned announcement first, and only while the pin lasts", () => {
    const pinned = record({ id: "p", title: "Pinned", content: "c", date: "2020-01-01", pinned: true, pinOrder: 1, pinExpires: "2026-12-31" });
    const recent = record({ id: "r", title: "Recent", content: "c", date: "2026-10-01" });
    const data = { settings: DEFAULT_SETTINGS, sections: { ...live.sections, Announcements: [recent, pinned] } };
    assert.ok(renderHome(web, data, "2026-10-15").announcements.indexOf("Pinned") < renderHome(web, data, "2026-10-15").announcements.indexOf("Recent"));
    assert.ok(renderHome(web, data, "2027-01-01").announcements.indexOf("Recent") < renderHome(web, data, "2027-01-01").announcements.indexOf("Pinned"));
  });

  it("name a form for a screen reader, in both languages", () => {
    const html = formCard(record({ id: "f", title: 'Permit "A"', url: "https://forms.example/f" }));
    assert.match(html, /data-open-form data-id="f" aria-label="[^"]*Permit &quot;A&quot;[^"]*" data-i18n-attr="aria-label:home\.forms\.cardAria" data-i18n-vars="\{&quot;title&quot;:&quot;Permit \\&quot;A\\&quot;&quot;\}"/);
  });
});

describe("an archive", () => {
  it("has every card, the first page showing, each with its rank under every sort", () => {
    const { cards, total, entries } = renderArchive(web, "ExecutiveOrders", live, "2026-10-15", 9);
    assert.equal(total, live.sections.ExecutiveOrders.length);
    assert.equal((cards.match(/<article /g) ?? []).length, total);
    assert.equal((cards.match(/<article class="document-card hidden"/g) ?? []).length, Math.max(0, total - 9));
    for (const mode of ["newest", "oldest", "numberasc", "numberdesc"]) assert.equal((cards.match(new RegExp(`data-rank-${mode}=`, "g")) ?? []).length, total, mode);
    assert.equal(entries.length, total);
  });

  it("gives announcements only the one rank, pinned first", () => {
    const { cards } = renderArchive(web, "Announcements", live, "2026-10-15", 9);
    assert.ok(!/data-rank-oldest/.test(cards) && /data-rank-newest="0"/.test(cards));
  });
});

describe("a document's page", () => {
  const settings = { ...DEFAULT_SETTINGS, mayorName: "Hon. Test", defaultDocumentImageUrl: "https://img.example/head.png", defaultSignatureImageUrl: "https://img.example/sig.png", defaultSignatoryName: "Default Signer" };

  it("is a standard document: heading, body, the mayor's office", () => {
    const item = record({ id: "r1", title: "Resolution", number: "Resolusyon Blg. 02", date: "2026-03-01", content: "**Bold** text" });
    const page = renderDocumentPage(web, "Resolutions", item, settings);
    assert.equal(page.title, "Resolution");
    assert.equal(page.titleKey, undefined);
    assert.ok(page.html.includes("<strong>Bold</strong> text"));
    assert.ok(page.html.includes("<h2>Resolution</h2>") && page.html.includes("Hon. Test"));
    assert.ok(page.html.includes('<img class="official-document-cover" src="https://img.example/head.png"'));
    assert.ok(page.html.includes('href="/resolutions/"'), "the back link goes to its archive, under the site's base");
  });

  it("is a memorandum: letterhead, the header rows, the signature block", () => {
    const item = record({ id: "m1", title: "Subject line", number: "Memorandum Blg. 2026-04", date: "2026-04-01", content: "body", memoTo: "All", memoFrom: "Mayor", signatoryName: "" });
    const page = renderDocumentPage(kiosk, "Memorandums", item, settings);
    assert.equal(page.title, "Memorandum Blg. 2026-04");
    assert.ok(page.html.includes('class="memorandum-letterhead" src="https://img.example/head.png"'));
    assert.ok(page.html.includes('class="memorandum-signature-image" src="https://img.example/sig.png"'));
    assert.match(page.html, /memorandum-meta-label"[^>]*>PARA<\/span>|memorandum-meta-label[^>]*>[^<]*<\/span>\s*<span class="memorandum-meta-colon">:<\/span>\s*<strong>All<\/strong>/);
    assert.ok(page.html.includes("Subject line") && page.html.includes("Default Signer"));
    assert.ok(page.html.includes('data-date="2026-04-01" data-date-style="memo"'));
  });

  it("falls back to the kind of document for a title when staff gave none, so the language can change it", () => {
    const page = renderDocumentPage(web, "Memorandums", record({ title: "T", content: "c" }), settings);
    assert.equal(page.titleKey, "section.Memorandums.singular");
  });

  it("has a print button on the web build and none on a kiosk", () => {
    const item = record({ title: "T", content: "c" });
    assert.ok(renderDocumentPage(web, "Resolutions", item, settings).html.includes("data-print"));
    assert.ok(!renderDocumentPage(kiosk, "Resolutions", item, settings).html.includes("data-print"));
  });

  it("renders a body's links as links on the web and as plain text on a kiosk", () => {
    const item = record({ title: "T", content: "See [the form](https://example.com/f)." });
    assert.ok(renderDocumentPage(web, "Resolutions", item, settings).html.includes('<a href="https://example.com/f"'));
    const onKiosk = renderDocumentPage(kiosk, "Resolutions", item, settings).html;
    assert.ok(onKiosk.includes("See the form.") && !onKiosk.includes('href="https://example.com/f"'));
  });
});

describe("a form's pop-out", () => {
  const form = record({ id: "f1", title: "Permit", url: "https://forms.example/permit", content: "Bring your ID.", image: "https://img.example/f.png" });

  it("shows the instructions, with the link on the web", () => {
    const html = renderFormDialog(web, form);
    assert.ok(html.includes("<h2 id=\"viewerTitle\">Permit</h2>") && html.includes("Bring your ID."));
    assert.ok(html.includes('id="viewerExternalLink"') && html.includes('href="https://forms.example/permit"'));
    assert.ok(!html.includes("data-citizen-scan-slot") && !html.includes("external-placeholder-note"));
  });

  it("holds the scan step's place and a placeholder instead of the link on a kiosk", () => {
    const html = renderFormDialog(kiosk, form);
    assert.ok(html.includes("<div data-citizen-scan-slot></div>"));
    assert.ok(html.includes("external-placeholder-note") && html.includes("is-disabled") && !html.includes("forms.example"));
  });

  it("says something when a form has no instructions", () => {
    const html = renderFormDialog(web, record({ title: "Bare", url: "https://forms.example/b" }));
    assert.ok(html.includes('data-i18n="viewer.defaultBody"'));
  });
});

describe("the parts that come from the settings", () => {
  it("make the seal from the logo, else 'LS'", () => {
    assert.ok(brandSeal("https://img.example/logo.png").includes('class="brand-seal has-image" data-brand-seal'));
    assert.equal(brandSeal(""), '<span class="brand-seal" data-brand-seal aria-hidden="true">LS</span>');
  });

  it("show the mayor, or the building", () => {
    assert.ok(mayorPhoto("https://img.example/m.png").includes('id="mayorImage"'));
    assert.ok(mayorPhoto("").includes("hero-panel-icon"));
  });

  it("make the hero's picture a style value, quoted so the address cannot end it early", () => {
    assert.equal(heroImageStyle(""), "");
    assert.equal(heroImageStyle('https://img.example/a"b.png'), '--hero-image: url("https://img.example/a%22b.png")');
  });
});

describe("attributes", () => {
  it("cannot be added to by what a record says: only the card's own are there", () => {
    const item = record({ title: `a" onclick="x`, description: `" autofocus="`, number: `'`, content: `c" data-evil="1`, icon: `" x="` });
    const html = documentCard(web, item, "Resolutions", { ranks: { newest: 0 }, position: 0 });
    const tag = skeleton(html.slice(0, html.indexOf(">") + 1));
    assert.equal(tag, '<article class="" data-card="" data-search="" data-position="" data-rank-newest="">');
    assert.ok(!/data-evil|autofocus|onclick/.test(tags(html)), tags(html));
  });
});
