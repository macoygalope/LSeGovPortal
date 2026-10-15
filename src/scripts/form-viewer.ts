// Opens a form's instructions (made by lib/render.ts, renderFormDialog, from the
// content the page loaded) in the pop-out (components/FormViewer.astro). The
// open form is mirrored in the URL hash (#form=<id>) so the browser Back button
// closes it and a form can be linked to directly.

import { type RenderContext, renderFormDialog } from "../lib/render.ts";
import type { EgovRecord } from "../lib/types.ts";
import { mountCitizenScan } from "./citizen-scan.ts";
import { applyTranslations } from "./i18n.ts";

/** Wires the pop-out to `forms`, once the page has them. */
export function initFormViewer(forms: readonly EgovRecord[], ctx: RenderContext): void {
  const viewer = document.getElementById("documentViewer");
  const container = document.getElementById("viewerDocument");
  const closeButton = document.getElementById("closeDocumentViewer");

  let lastOpener: HTMLElement | null = null;

  function isOpen(): boolean {
    return viewer?.classList.contains("open") ?? false;
  }

  function show(id: string): boolean {
    const form = forms.find((candidate) => candidate.id === id);
    if (!viewer || !container || !form) return false;

    container.innerHTML = renderFormDialog(ctx, form);
    // Kiosk build only: a fresh scan step each time a form is opened.
    const slot = container.querySelector("[data-citizen-scan-slot]");
    const scan = document.getElementById("citizenScanTemplate");
    if (slot && scan instanceof HTMLTemplateElement) slot.replaceWith(scan.content.cloneNode(true));
    // The markup is in the default language; match the chosen one.
    applyTranslations(container);
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
}
