// Browser side of src/lib/i18n.ts. The pages arrive in Filipino; this swaps
// the interface text to the visitor's chosen language and remembers the choice.
//
// An element opts in with attributes written at build time:
//   data-i18n="key"            replaces its text
//   data-i18n-attr="a:key;b:key"  sets the attributes a, b
//   data-i18n-vars='{"x":1}'   values for {x} placeholders in those messages
//   data-date / data-date-style   a date that is re-formatted (see lib/format.ts)

import { formatDateStyle, type DateStyle } from "../lib/format.ts";
import {
  DEFAULT_LANG,
  LANG_STORAGE_KEY,
  isLang,
  translate,
  type Lang,
  type MessageKey,
  type MessageVars,
} from "../lib/i18n.ts";

/** Fired on `document` after the language changes; detail is the new Lang. */
export const LANG_CHANGE_EVENT = "egov:langchange";

let current: Lang | undefined;

export function getLang(): Lang {
  if (!current) {
    current = DEFAULT_LANG;
    try {
      const stored = localStorage.getItem(LANG_STORAGE_KEY);
      if (isLang(stored)) current = stored;
    } catch {
      // Storage can be blocked (private window, kiosk browser); stay default.
    }
  }
  return current;
}

/** Translates in the language currently shown. */
export function t(key: MessageKey, vars?: MessageVars): string {
  return translate(getLang(), key, vars);
}

function readVars(element: HTMLElement): MessageVars | undefined {
  if (!element.dataset.i18nVars) return undefined;
  try {
    return JSON.parse(element.dataset.i18nVars) as MessageVars;
  } catch {
    return undefined;
  }
}

/** Re-renders every translatable element under `root` in `lang`. */
export function applyTranslations(root: ParentNode = document, lang: Lang = getLang()): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    element.textContent = translate(lang, element.dataset.i18n as MessageKey, readVars(element));
  });

  root.querySelectorAll<HTMLElement>("[data-i18n-attr]").forEach((element) => {
    const vars = readVars(element);
    for (const pair of element.dataset.i18nAttr!.split(";")) {
      const separator = pair.indexOf(":");
      if (separator < 1) continue;
      element.setAttribute(pair.slice(0, separator), translate(lang, pair.slice(separator + 1) as MessageKey, vars));
    }
  });

  root.querySelectorAll<HTMLElement>("[data-date]").forEach((element) => {
    const style = (element.dataset.dateStyle as DateStyle) || "long";
    element.textContent = formatDateStyle(element.dataset.date ?? "", style, lang);
  });

  if (root === document) {
    // "<page> — <site>"; the site name isn't translated.
    const title = document.querySelector<HTMLElement>("title[data-title-key]");
    if (title) {
      document.title = `${translate(lang, title.dataset.titleKey as MessageKey)} — ${title.dataset.titleSuffix ?? ""}`;
    }
  }
}

/** Switches language, re-renders the page, and remembers the choice. */
export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // The choice just won't survive a reload.
  }
  document.documentElement.lang = lang;
  applyTranslations(document, lang);
  document.dispatchEvent(new CustomEvent<Lang>(LANG_CHANGE_EVENT, { detail: lang }));
}

export function onLangChange(callback: (lang: Lang) => void): void {
  document.addEventListener(LANG_CHANGE_EVENT, (event) => callback((event as CustomEvent<Lang>).detail));
}
