// Opens a form's pre-rendered instructions (see FormViewer.astro) in the
// pop-out. The open form is mirrored in the URL hash (#form=<id>) so the
// browser Back button closes it and a form can be linked to directly.

import { mountCitizenScan } from "./citizen-scan.ts";
import { applyTranslations } from "./i18n.ts";

const viewer = document.getElementById("documentViewer");
const container = document.getElementById("viewerDocument");
const closeButton = document.getElementById("closeDocumentViewer");

let lastOpener: HTMLElement | null = null;

function findTemplate(id: string): HTMLTemplateElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLTemplateElement>("template[data-form-id]")).find(
      (template) => template.dataset.formId === id,
    ) ?? null
  );
}

function isOpen(): boolean {
  return viewer?.classList.contains("open") ?? false;
}

function show(id: string): boolean {
  const template = findTemplate(id);
  if (!viewer || !container || !template) return false;

  container.replaceChildren(template.content.cloneNode(true));
  // The template is pre-rendered in the default language; match the chosen one.
  applyTranslations(container);
  // Kiosk build only: a fresh scan step each time a form is opened.
  mountCitizenScan(container);
  viewer.classList.add("open");
  viewer.setAttribute("aria-hidden", "false");
  document.body.classList.add("viewer-open");
  viewer.querySelector<HTMLElement>(".viewer-scroll")?.scrollTo({ top: 0 });
  closeButton?.focus();
  return true;
}

function hide() {
  if (!viewer) return;
  viewer.classList.remove("open");
  viewer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("viewer-open");
  lastOpener?.focus();
  lastOpener = null;
}

function formIdFromHash(): string | null {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash.startsWith("form=")) return null;
  return new URLSearchParams(hash).get("form");
}

function open(id: string, opener: HTMLElement | null) {
  lastOpener = opener;
  if (show(id)) history.pushState({ form: id }, "", `#form=${encodeURIComponent(id)}`);
}

function close() {
  if (!isOpen()) return;
  // Going back removes the #form= entry we pushed, and popstate hides it.
  if (formIdFromHash() && history.state?.form) history.back();
  else hide();
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const opener = target.closest<HTMLElement>("[data-open-form]");
  if (opener?.dataset.id) {
    open(opener.dataset.id, opener);
    return;
  }
  if (target.closest("[data-close-viewer]") || target.closest("#closeDocumentViewer")) close();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") close();
});

window.addEventListener("popstate", () => {
  const id = formIdFromHash();
  if (id) show(id);
  else hide();
});

const initial = formIdFromHash();
if (initial) show(initial);
