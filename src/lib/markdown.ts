import { escapeHtml } from "./format.ts";
import { t, type MessageKey } from "./i18n.ts";

/**
 * Safe subset of Markdown for long official documents. Supported: headings,
 * bold, italic, links, blockquote, bullet list, numbered list, and a
 * horizontal separator. Ported unchanged in behaviour from the old
 * shared.js `documentContentToHtml`, including the special styling for
 * SEKSYON / SAPAGKAT style legal openers.
 *
 * Input is HTML-escaped before any markup is added, so the output is safe to
 * inject with `set:html`.
 *
 * Pass `links: false` to render link text without the anchor -- the kiosk
 * build does, since the kiosk screen can't be assumed to open external sites.
 *
 * Empty content renders a placeholder paragraph; `emptyKey` picks its message.
 */
export function documentContentToHtml(
  content: string,
  options: { links?: boolean; emptyKey?: MessageKey } = {},
): string {
  const { links = true, emptyKey = "doc.emptyBody" } = options;
  const normalized = String(content || "").replace(/\r\n?/g, "\n").trim();
  // The placeholder is interface text, so it stays translatable in the browser.
  if (!normalized) return `<p data-i18n="${emptyKey}">${escapeHtml(t(emptyKey))}</p>`;

  function formatInline(text: string): string {
    let formatted = escapeHtml(text);

    // Link: [Pangalan](https://example.com)
    formatted = formatted.replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_match, label: string, url: string) =>
        links ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>` : label,
    );

    // ***Bold at italic*** o ___Bold at italic___
    formatted = formatted
      .replace(/\*\*\*([^*\n]+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/___([^_\n]+?)___/g, "<strong><em>$1</em></strong>");

    // **Bold** o __Bold__
    formatted = formatted
      .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_\n]+?)__/g, "<strong>$1</strong>");

    // *Italic* o _Italic_. Underscores inside words are left alone.
    formatted = formatted
      .replace(/(^|[\s([{>])\*([^*\n]+?)\*(?=$|[\s.,;:!?)}\]<>])/g, "$1<em>$2</em>")
      .replace(/(^|[\s([{>])_([^_\n]+?)_(?=$|[\s.,;:!?)}\]<>])/g, "$1<em>$2</em>");

    return formatted;
  }

  function paragraphClasses(plainText: string): string {
    const classes: string[] = [];
    const comparableText = plainText.replace(/^[*_`~\s]+/, "");
    if (/^(SEKSYON|SECTION|ARTIKULO|ARTICLE|KABANATA|CHAPTER|PAKSA|SUBJECT)\b/i.test(comparableText)) {
      classes.push("document-section-title");
    }
    if (/^(SAPAGKAT|IPINASIYA|IPINAG-UUTOS|NOW, THEREFORE|WHEREAS|RESOLVED)\b/i.test(comparableText)) {
      classes.push("document-clause");
    }
    return classes.length ? ` class="${classes.join(" ")}"` : "";
  }

  const lines = normalized.split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let listType: "ordered" | "unordered" | "" = "";
  let listItems: string[] = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    const plain = paragraph.join("\n").trim();
    if (plain) {
      html.push(`<p${paragraphClasses(plain)}>${paragraph.map(formatInline).join("<br>")}</p>`);
    }
    paragraph = [];
  }

  function flushList() {
    if (!listType || !listItems.length) return;
    const tag = listType === "ordered" ? "ol" : "ul";
    html.push(
      `<${tag} class="document-list">${listItems.map((item) => `<li>${formatInline(item)}</li>`).join("")}</${tag}>`,
    );
    listType = "";
    listItems = [];
  }

  function startOrContinueList(type: "ordered" | "unordered", item: string) {
    flushParagraph();
    if (listType && listType !== type) flushList();
    listType = type;
    listItems.push(item.trim());
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 1, 4);
      html.push(`<h${level} class="document-markdown-heading">${formatInline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(---|___)\s*$/.test(trimmed)) {
      flushParagraph();
      flushList();
      html.push(`<hr class="document-divider">`);
      continue;
    }

    const unordered = line.match(/^\s*[-+]\s+(.+)$/);
    if (unordered) {
      startOrContinueList("unordered", unordered[1]);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      startOrContinueList("ordered", ordered[1]);
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote class="document-quote">${formatInline(quote[1])}</blockquote>`);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return html.join("");
}
