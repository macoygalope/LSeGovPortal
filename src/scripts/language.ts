// Page-level language wiring, loaded by every page (Layout.astro): shows the saved language and drives the footer dropdown.

import { DEFAULT_LANG, isLang } from "../lib/i18n.ts";
import { applyTranslations, getLang, setLang } from "./i18n.ts";

const lang = getLang();
if (lang !== DEFAULT_LANG) {
  document.documentElement.lang = lang;
  applyTranslations(document, lang);
}
// LangBootstrap.astro hides the page while a non-default language is pending.
document.documentElement.removeAttribute("data-lang-pending");

const select = document.querySelector<HTMLSelectElement>("[data-language-select]");
if (select) {
  select.value = lang;
  select.addEventListener("change", () => {
    if (isLang(select.value)) setLang(select.value);
  });
}
