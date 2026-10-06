// Wires up the fingerprint-scan step of a form's pop-out (see
// components/CitizenScan.astro): hold the button for HOLD_DURATION, look the
// citizen up, then swap the step for their identity card. Port of
// prestige-lspd-website's useHoldToScan / ScanDisclaimerStep / IdentityCard.

import { fetchCitizenIdentity, getCurrentCitizenId, type CitizenIdentity } from "../lib/citizen.ts";
import type { MessageKey, MessageVars } from "../lib/i18n.ts";
import { t } from "./i18n.ts";

export const HOLD_DURATION = 3000;

/** Sets text that follows the chosen language, including after a later switch. */
function setMessage(element: HTMLElement, key: MessageKey, vars?: MessageVars): void {
  element.dataset.i18n = key;
  if (vars) element.dataset.i18nVars = JSON.stringify(vars);
  else delete element.dataset.i18nVars;
  element.textContent = t(key, vars);
}

function query<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`citizen scan: missing ${selector}`);
  return element;
}

function showIdentity(scan: HTMLElement, citizen: CitizenIdentity): void {
  if (citizen.photo) {
    const photo = query<HTMLImageElement>(scan, "[data-identity-photo]");
    photo.src = citizen.photo;
    photo.hidden = false;
    // An <svg>, which has no `hidden` property to set.
    query<HTMLElement>(scan, "[data-identity-photo-fallback]").toggleAttribute("hidden", true);
  }

  query(scan, "[data-identity-name]").textContent = citizen.fullName;
  query(scan, "[data-identity-citizen-id]").textContent = citizen.citizenId;

  const fields: [selector: string, value: string | null][] = [
    ["[data-identity-dob]", citizen.dateOfBirth],
    ["[data-identity-fingerprint]", citizen.fingerprintId],
  ];
  for (const [selector, value] of fields) {
    const element = query(scan, selector);
    if (value) element.textContent = value;
    else setMessage(element, "citizen.id.notOnFile");
  }

  query(scan, "[data-scan-step]").hidden = true;
  query(scan, "[data-identity-card]").hidden = false;
}

/** Activates the scan step inside `root`, if it has one (kiosk build only). */
export function mountCitizenScan(root: ParentNode): void {
  const found = root.querySelector<HTMLElement>("[data-citizen-scan]");
  if (!found) return;
  const scan: HTMLElement = found;

  const button = query<HTMLButtonElement>(scan, "[data-scan-button]");
  const fill = query(scan, "[data-scan-fill]");
  const status = query(scan, "[data-scan-status]");
  const message = query(scan, "[data-scan-message]");

  let interval: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let startedAt = 0;
  let verifying = false;

  function setProgress(percent: number): void {
    fill.style.height = `${percent}%`;
    button.classList.toggle("is-scanning", percent > 0);
    const label = percent > 0 ? "citizen.scan.scanning" : "citizen.scan.hold";
    if (status.dataset.i18n !== label) setMessage(status, label);
  }

  function stopTimers(): void {
    clearInterval(interval);
    clearTimeout(timeout);
    interval = timeout = undefined;
  }

  async function complete(): Promise<void> {
    stopTimers();
    // The pop-out was closed mid-hold (it is only hidden, not removed).
    if (button.offsetParent === null) {
      setProgress(0);
      return;
    }

    setProgress(100);
    verifying = true;
    message.hidden = false;
    message.classList.remove("is-error");
    setMessage(message, "citizen.scan.verifying");

    try {
      showIdentity(scan, await fetchCitizenIdentity(getCurrentCitizenId()));
    } catch (error) {
      message.classList.add("is-error");
      setMessage(message, "citizen.error", {
        detail: error instanceof Error ? error.message : String(error),
      });
      setProgress(0);
    } finally {
      verifying = false;
    }
  }

  function startHold(): void {
    if (verifying || timeout) return;
    message.hidden = true;
    startedAt = Date.now();
    interval = setInterval(() => {
      setProgress(Math.min(((Date.now() - startedAt) / HOLD_DURATION) * 100, 100));
    }, 16);
    timeout = setTimeout(complete, HOLD_DURATION);
  }

  function cancelHold(): void {
    // A completed hold is already being verified; releasing the button
    // afterwards must not wipe the filled state out from under it.
    if (verifying) return;
    stopTimers();
    setProgress(0);
  }

  // Pointer events cover mouse (the kiosk's DUI sends real mouse input) and
  // touch alike, without a touch tap also firing emulated mouse events.
  button.addEventListener("pointerdown", startHold);
  button.addEventListener("pointerup", cancelHold);
  button.addEventListener("pointerleave", cancelHold);
  button.addEventListener("pointercancel", cancelHold);
  // No long-press menu on touch screens.
  button.addEventListener("contextmenu", (event) => event.preventDefault());
}
