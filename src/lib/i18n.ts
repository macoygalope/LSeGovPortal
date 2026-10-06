import { en } from "./messages/en.ts";
import { fil } from "./messages/fil.ts";

/**
 * Localization. Pages are built in the default language (Filipino/Tagalog);
 * every translatable element also carries a `data-i18n*` attribute, and
 * src/scripts/i18n.ts swaps the text in the browser when the visitor picks
 * another language in the footer. That keeps the site fully static -- one
 * build, one set of URLs -- which the kiosk hosting needs.
 *
 * Content that staff type into the Google Sheet (titles, bodies, ...) is
 * shown as written in every language; only the interface is translated.
 */

export const LANGS = ["fil", "en"] as const;
export type Lang = (typeof LANGS)[number];
export type MessageKey = keyof typeof fil;

export const DEFAULT_LANG: Lang = "fil";
export const LANG_STORAGE_KEY = "egov-lang";

/** Each language's name, written in that language (never translated). */
export const LANG_NAMES: Record<Lang, string> = {
  fil: "Filipino (Tagalog)",
  en: "English",
};

const MESSAGES: Record<Lang, Record<MessageKey, string>> = { fil, en };

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

export type MessageVars = Record<string, string | number>;

export function translate(lang: Lang, key: MessageKey, vars?: MessageVars): string {
  const text = MESSAGES[lang][key] ?? MESSAGES[DEFAULT_LANG][key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in vars ? String(vars[name]) : placeholder,
  );
}

/** Build-time translation: pages are rendered in the default language. */
export function t(key: MessageKey, vars?: MessageVars): string {
  return translate(DEFAULT_LANG, key, vars);
}

/**
 * Attributes that make an element's text swappable in the browser:
 * `<h2 {...i18n("home.forms.title")}>{t("home.forms.title")}</h2>`.
 */
export function i18n(key: MessageKey, vars?: MessageVars): Record<string, string> {
  return { "data-i18n": key, ...(vars ? { "data-i18n-vars": JSON.stringify(vars) } : {}) };
}

/**
 * The same for attributes (placeholder, aria-label, alt, content, ...):
 * `<input {...i18nAttr({ placeholder: "archive.searchPlaceholder" })} />`.
 */
export function i18nAttr(
  attributes: Record<string, MessageKey>,
  vars?: MessageVars,
): Record<string, string> {
  return {
    "data-i18n-attr": Object.entries(attributes)
      .map(([attribute, key]) => `${attribute}:${key}`)
      .join(";"),
    ...(vars ? { "data-i18n-vars": JSON.stringify(vars) } : {}),
  };
}

/** Site settings whose built-in default text has a translation. */
const SETTING_KEYS = {
  siteSubtitle: "settings.siteSubtitle",
  heroTitle: "settings.heroTitle",
  heroDescription: "settings.heroDescription",
  meetingButtonLabel: "settings.meetingButtonLabel",
  defaultSignatoryPosition: "settings.defaultSignatoryPosition",
  footerText: "settings.footerText",
} as const satisfies Record<string, MessageKey>;

export type TranslatableSetting = keyof typeof SETTING_KEYS;

/**
 * The message key for a site setting, but only while it still holds the
 * built-in default. Once staff customise it, the text is theirs and is shown
 * as written in every language.
 */
export function settingKey(name: TranslatableSetting, value: string): MessageKey | undefined {
  return value === t(SETTING_KEYS[name]) ? SETTING_KEYS[name] : undefined;
}

export function settingI18n(name: TranslatableSetting, value: string): Record<string, string> {
  const key = settingKey(name, value);
  return key ? i18n(key) : {};
}

/**
 * The dashboard shows errors thrown by google-apps-script/Code.gs, which are
 * Filipino sentences. `admin.be.*` messages are those exact sentences, so a
 * backend error can be mapped back to its key and shown in the chosen language.
 */
const BACKEND_ERRORS = new Map<string, MessageKey>(
  (Object.keys(fil) as MessageKey[])
    .filter((key) => key.startsWith("admin.be."))
    .map((key) => [fil[key], key]),
);

export function translateBackendError(message: string, lang: Lang): string {
  const key = BACKEND_ERRORS.get(message);
  return key ? translate(lang, key) : message;
}
