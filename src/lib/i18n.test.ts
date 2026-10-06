import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatDate, formatDateStyle } from "./format.ts";
import {
  DEFAULT_LANG,
  LANGS,
  i18n,
  i18nAttr,
  isLang,
  settingKey,
  t,
  translate,
  translateBackendError,
  type MessageKey,
} from "./i18n.ts";
import { documentContentToHtml } from "./markdown.ts";
import { en } from "./messages/en.ts";
import { fil } from "./messages/fil.ts";
import { DEFAULT_SETTINGS } from "./normalize.ts";

const keys = Object.keys(fil) as MessageKey[];
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("message catalogs", () => {
  it("define exactly the same keys in every language", () => {
    assert.deepEqual(Object.keys(en).sort(), [...keys].sort());
  });

  it("have no empty messages", () => {
    for (const lang of LANGS) {
      for (const key of keys) assert.notEqual(translate(lang, key).trim(), "", `${lang}:${key}`);
    }
  });

  it("use the same {placeholders} in every language", () => {
    for (const key of keys) assert.deepEqual(placeholders(en[key]), placeholders(fil[key]), key);
  });
});

describe("translate", () => {
  it("fills in placeholders and leaves unknown ones alone", () => {
    assert.equal(translate("en", "home.forms.cardAria", { title: "Permit" }), "View the details of Permit first");
    assert.equal(translate("en", "admin.uploadPart", { current: 2 }), "Uploading part 2 of {total}…");
  });

  it("builds pages in the default language, which is Filipino", () => {
    assert.equal(DEFAULT_LANG, "fil");
    assert.equal(t("nav.announcements"), "Mga Anunsyo");
  });

  it("recognises supported languages only", () => {
    assert.ok(isLang("fil") && isLang("en"));
    assert.ok(!isLang("tl") && !isLang(undefined));
  });
});

describe("markup helpers", () => {
  it("emit the attributes the browser script reads", () => {
    assert.deepEqual(i18n("nav.forms"), { "data-i18n": "nav.forms" });
    assert.deepEqual(i18n("viewer.coverAlt", { title: "A" }), {
      "data-i18n": "viewer.coverAlt",
      "data-i18n-vars": '{"title":"A"}',
    });
    assert.deepEqual(i18nAttr({ placeholder: "archive.searchPlaceholder", "aria-label": "nav.menuOpen" }), {
      "data-i18n-attr": "placeholder:archive.searchPlaceholder;aria-label:nav.menuOpen",
    });
  });
});

describe("site settings", () => {
  it("are translated only while they still hold the built-in default", () => {
    assert.equal(settingKey("footerText", DEFAULT_SETTINGS.footerText), "settings.footerText");
    assert.equal(settingKey("footerText", "© Custom footer"), undefined);
  });
});

describe("backend errors", () => {
  it("are translated by their exact Filipino text, and unknown ones pass through", () => {
    assert.equal(translateBackendError("Mali ang admin token.", "en"), "The admin token is incorrect.");
    assert.equal(translateBackendError("Mali ang admin token.", "fil"), "Mali ang admin token.");
    assert.equal(translateBackendError("Something else", "en"), "Something else");
  });
});

describe("dates", () => {
  it("read naturally in each language", () => {
    assert.equal(formatDate("2026-08-05"), "5 Agosto 2026");
    assert.equal(formatDate("2026-08-05", "en"), "5 August 2026");
    assert.equal(formatDateStyle("2026-08-05", "memo"), "Agosto 5, 2026");
    assert.equal(formatDateStyle("2026-08-05", "memo", "en"), "August 5, 2026");
  });

  it("handle missing and unparseable dates", () => {
    assert.equal(formatDate(""), "Walang nakatalang petsa");
    assert.equal(formatDate("", "en"), "No date recorded");
    assert.equal(formatDate("soon", "en"), "soon");
  });
});

describe("empty document body", () => {
  it("renders a placeholder that can be translated in the browser", () => {
    assert.equal(
      documentContentToHtml(""),
      '<p data-i18n="doc.emptyBody">Wala pang nailalathalang buong nilalaman.</p>',
    );
    assert.ok(documentContentToHtml("", { emptyKey: "viewer.defaultBody" }).includes('data-i18n="viewer.defaultBody"'));
  });
});
