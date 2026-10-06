import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  documentSequence,
  documentYear,
  localTodayIso,
  orderedAnnouncements,
  sortDocuments,
} from "./documents.ts";
import { documentContentToHtml } from "./markdown.ts";
import { normalizePayload, normalizeRecord, toBool } from "./normalize.ts";
import { imageSourceUrl, safeUrl } from "./format.ts";
import { withBase } from "./url.ts";
import type { EgovRecord } from "./types.ts";

function record(overrides: Partial<EgovRecord>): EgovRecord {
  return normalizeRecord({ id: "x", published: true, ...overrides });
}

describe("normalize", () => {
  it("reads booleans however Sheets serialises them", () => {
    assert.equal(toBool(true), true);
    assert.equal(toBool("TRUE"), true);
    assert.equal(toBool("true"), true);
    assert.equal(toBool("false"), false);
    assert.equal(toBool(""), false);
    assert.equal(toBool(undefined), false);
  });

  it("drops drafts and id-less rows", () => {
    const data = normalizePayload({
      ok: true,
      data: {
        SiteSettings: {},
        Forms: [],
        Announcements: [
          { id: "a", title: "kept", published: "true" },
          { id: "b", title: "draft", published: "false" },
          { id: "", title: "no id", published: true },
        ],
        ExecutiveOrders: [],
        Memorandums: [],
        Resolutions: [],
      },
    });
    assert.deepEqual(data.sections.Announcements.map((r) => r.id), ["a"]);
  });

  it("fails loudly on a bad or partial payload", () => {
    assert.throws(() => normalizePayload({ ok: false, error: "Mali ang token" }), /Mali ang token/);
    assert.throws(() => normalizePayload({ ok: true, data: { Forms: [] } }), /missing the "Announcements"/);
    assert.throws(() => normalizePayload(null));
  });

  it("falls back to defaults for blank settings", () => {
    const { settings } = normalizePayload({
      ok: true,
      data: {
        SiteSettings: { siteTitle: "", mayorName: "Hon. Test" },
        Forms: [], Announcements: [], ExecutiveOrders: [], Memorandums: [], Resolutions: [],
      },
    });
    assert.equal(settings.siteTitle, "Los Santos eGov");
    assert.equal(settings.mayorName, "Hon. Test");
  });
});

describe("live fixture", () => {
  const raw = JSON.parse(readFileSync("fixtures/live-all.json", "utf8"));
  const data = normalizePayload(raw);

  it("normalises every section of a real response", () => {
    assert.ok(data.sections.ExecutiveOrders.length > 0);
    for (const records of Object.values(data.sections)) {
      for (const r of records) {
        assert.equal(typeof r.order, "number");
        assert.equal(r.published, true);
        assert.equal(typeof r.pinned, "boolean");
      }
    }
  });

  it("every published document has a unique id (ids become URLs)", () => {
    for (const records of Object.values(data.sections)) {
      const ids = records.map((r) => r.id);
      assert.equal(new Set(ids).size, ids.length);
    }
  });
});

describe("numbering and sorting", () => {
  it("orders the live Executive Orders by their printed number", () => {
    const eos = normalizePayload(JSON.parse(readFileSync("fixtures/live-all.json", "utf8"))).sections
      .ExecutiveOrders;
    const asc = sortDocuments(eos, "numberAsc").map((r) => documentSequence(r));
    assert.deepEqual(asc, [...asc].sort((a, b) => a - b), `not ascending: ${asc}`);
    assert.ok(asc.every((n) => n > 0), `some numbers unparsed: ${asc}`);
  });

  it("prefers stored sequence/year, else parses the printed number", () => {
    assert.equal(documentSequence(record({ publicationSequence: 9, number: "Blg. 3" })), 9);
    assert.equal(documentSequence(record({ number: "Memorandum Blg. 2026-11" })), 11);
    assert.equal(documentSequence(record({ number: "Executive Order Blg. 07, Serye ng 2026" })), 7);
    // The format actually used by the live Executive Orders.
    assert.equal(documentSequence(record({ number: "KAUTUSANG TAGAPAGPAGANAP BLG.: 07 Serye ng 2026" })), 7);
    assert.equal(documentYear(record({ number: "KAUTUSANG TAGAPAGPAGANAP BLG.: 07 Serye ng 2026" })), 2026);
    assert.equal(documentYear(record({ number: "Executive Order Blg. 07, Serye ng 2025" })), 2025);
    assert.equal(documentYear(record({ number: "Memorandum Blg. 2026-11" })), 2026);
    assert.equal(documentYear(record({ number: "", date: "2024-03-01" })), 2024);
  });

  it("sorts by number across years", () => {
    const items = [
      record({ id: "a", publicationYear: 2026, publicationSequence: 2 }),
      record({ id: "b", publicationYear: 2025, publicationSequence: 9 }),
      record({ id: "c", publicationYear: 2026, publicationSequence: 10 }),
    ];
    assert.deepEqual(sortDocuments(items, "numberAsc").map((r) => r.id), ["b", "a", "c"]);
    assert.deepEqual(sortDocuments(items, "numberDesc").map((r) => r.id), ["c", "a", "b"]);
  });

  it("sorts newest/oldest by date", () => {
    const items = [
      record({ id: "a", date: "2026-01-02" }),
      record({ id: "b", date: "2026-03-01" }),
    ];
    assert.deepEqual(sortDocuments(items, "newest").map((r) => r.id), ["b", "a"]);
    assert.deepEqual(sortDocuments(items, "oldest").map((r) => r.id), ["a", "b"]);
  });

  it("does not mutate its input", () => {
    const items = [record({ id: "a", date: "2026-01-02" }), record({ id: "b", date: "2026-03-01" })];
    sortDocuments(items, "newest");
    assert.deepEqual(items.map((r) => r.id), ["a", "b"]);
  });
});

describe("pinned announcements", () => {
  const today = "2026-08-10";

  it("puts active pins first, ordered by pinOrder, max three", () => {
    const items = [
      record({ id: "old", date: "2026-01-01" }),
      record({ id: "p2", date: "2026-02-01", pinned: true, pinOrder: 2 }),
      record({ id: "p1", date: "2026-02-02", pinned: true, pinOrder: 1 }),
      record({ id: "p3", date: "2026-02-03", pinned: true, pinOrder: 3 }),
      record({ id: "p4", date: "2026-02-04", pinned: true, pinOrder: 4 }),
    ];
    const ordered = orderedAnnouncements(items, today);
    assert.deepEqual(ordered.map((o) => o.item.id), ["p1", "p2", "p3", "p4", "old"]);
    assert.deepEqual(ordered.map((o) => o.pinned), [true, true, true, false, false]);
  });

  it("treats an expired pin as a regular announcement", () => {
    const items = [
      record({ id: "expired", date: "2026-02-01", pinned: true, pinExpires: "2026-08-09" }),
      record({ id: "valid", date: "2026-01-01", pinned: true, pinExpires: "2026-08-10" }),
    ];
    const ordered = orderedAnnouncements(items, today);
    assert.deepEqual(ordered.map((o) => [o.item.id, o.pinned]), [["valid", true], ["expired", false]]);
  });

  it("formats local today as YYYY-MM-DD", () => {
    assert.equal(localTodayIso(new Date(2026, 7, 5)), "2026-08-05");
  });
});

describe("markdown", () => {
  it("escapes HTML before adding markup", () => {
    const html = documentContentToHtml("<script>alert(1)</script> **bold**");
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("<strong>bold</strong>"));
  });

  it("does not let a link label or url break out of the attribute", () => {
    const html = documentContentToHtml('[x](https://a.test/"onmouseover="alert(1))');
    assert.ok(!/onmouseover="alert/.test(html));
  });

  it("renders headings, lists and legal clauses", () => {
    const html = documentContentToHtml("## Pamagat\n\nSAPAGKAT, tungkulin\n\nSEKSYON 1. Layunin\n\n- isa\n- dalawa\n\n1. una\n2. pangalawa");
    assert.ok(html.includes('<h3 class="document-markdown-heading">Pamagat</h3>'));
    assert.ok(html.includes('class="document-clause"'));
    assert.ok(html.includes('class="document-section-title"'));
    assert.ok(html.includes('<ul class="document-list"><li>isa</li><li>dalawa</li></ul>'));
    assert.ok(html.includes('<ol class="document-list"><li>una</li><li>pangalawa</li></ol>'));
  });

  it("renders links as plain text when links are disabled (kiosk)", () => {
    const text = "Tingnan ang [opisyal na pahina](https://example.com/a) para sa detalye.";
    assert.ok(documentContentToHtml(text).includes('<a href="https://example.com/a"'));
    const plain = documentContentToHtml(text, { links: false });
    assert.ok(!plain.includes("<a "));
    assert.ok(!plain.includes("https://example.com"));
    assert.ok(plain.includes("Tingnan ang opisyal na pahina para sa detalye."));
  });

  it("shows a placeholder for empty content", () => {
    assert.ok(documentContentToHtml("  ").includes("Wala pang nailalathalang"));
  });
});

describe("urls", () => {
  it("only allows http(s) links", () => {
    assert.equal(safeUrl("https://example.com/a"), "https://example.com/a");
    assert.equal(safeUrl("javascript:alert(1)"), "");
    assert.equal(safeUrl("#"), "");
    assert.equal(safeUrl(""), "");
  });

  it("rewrites Google Drive share links to thumbnails", () => {
    assert.equal(
      imageSourceUrl("https://drive.google.com/file/d/abc123/view?usp=sharing"),
      "https://drive.google.com/thumbnail?id=abc123&sz=w1600",
    );
    assert.equal(imageSourceUrl("https://r2.fivemanage.com/x.png"), "https://r2.fivemanage.com/x.png");
  });

  it("prefixes internal links with the kiosk base", () => {
    const base = "/api/v1/websites/egov";
    assert.equal(withBase("/", base), "/api/v1/websites/egov");
    assert.equal(withBase("/announcements/", base), "/api/v1/websites/egov/announcements/");
    assert.equal(withBase("/#forms", base), "/api/v1/websites/egov/#forms");
    assert.equal(withBase("/announcements/", "/"), "/announcements/");
    assert.equal(withBase("/", "/"), "/");
  });
});
