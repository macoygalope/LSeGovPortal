/**
 * Who is using the kiosk. Same mechanism as prestige-lspd-website's
 * components/shared/FingerprintScan.tsx, so both sites behave alike inside a
 * kiosk: prestige-hardware's client/kiosks.lua opens the site with the
 * player's citizenid already on the URL (`?citizenId=`), and the scan step
 * turns that id into identity data through lspd-backend's public lookup.
 */

// Session-scoped, not localStorage: a fresh kiosk open always re-supplies
// ?citizenId=, so nothing here needs to outlive the browsing session, and it
// shouldn't -- a stale id from a previous player's visit must never leak into
// a later one.
const CITIZEN_ID_STORAGE_KEY = "lsegov-portal:citizenId";

// Set when the citizen is forgotten (see forgetCurrentCitizenId), so the
// development mock below doesn't put them straight back.
const CITIZEN_ID_FORGOTTEN_KEY = "lsegov-portal:citizenIdForgotten";

/**
 * Development only: a citizen to treat as using the site when the browser has
 * none, from PUBLIC_MOCK_CITIZEN_ID in `.env`, so the dashboard can be tried
 * without the game. In a build `import.meta.env.DEV` is replaced by `false`,
 * which leaves nothing of this behind; the two accesses are written out in
 * full on purpose, because naming `import.meta.env` as a whole would make
 * Vite put every variable in the bundle.
 */
export function devMockCitizenId(): string {
  try {
    return import.meta.env.DEV ? (import.meta.env.PUBLIC_MOCK_CITIZEN_ID ?? "").trim() : "";
  } catch {
    // Plain Node, as in the tests, has no import.meta.env.
    return "";
  }
}

/**
 * The `citizenId` query param prestige-hardware's client/kiosks.lua appends
 * when it opens this site on a kiosk screen. The screen is cross-origin
 * content from lspd-backend, so there is no NUI/native bridge to ask who the
 * player is -- the id has to arrive already resolved.
 *
 * The param only lands on the page the kiosk opens, and this site does full
 * navigations on every internal link, so it is stashed in sessionStorage on
 * the page that has it; pages reached later can still recover it. Returns ""
 * when neither is available, e.g. the site opened as a normal public website
 * outside the game -- fetchCitizenIdentity then fails with a real error
 * rather than faking a scan result.
 */
export function getCurrentCitizenId(mockId: string = devMockCitizenId()): string {
  if (typeof window === "undefined") return "";

  const fromUrl = new URLSearchParams(window.location.search).get("citizenId");
  if (fromUrl) {
    try {
      window.sessionStorage.setItem(CITIZEN_ID_STORAGE_KEY, fromUrl);
      // An id given on purpose ends the "forgotten" state.
      window.sessionStorage.removeItem(CITIZEN_ID_FORGOTTEN_KEY);
    } catch {
      // sessionStorage unavailable (privacy mode, kiosk browser) -- fromUrl
      // still works for this page, it just won't carry forward to the next.
    }
    return fromUrl;
  }

  try {
    const stored = window.sessionStorage.getItem(CITIZEN_ID_STORAGE_KEY);
    if (stored) return stored;
    if (mockId && !window.sessionStorage.getItem(CITIZEN_ID_FORGOTTEN_KEY)) return mockId;
  } catch {
    // Storage is blocked: nothing is stashed, and a mock has nothing to be forgotten in.
    return mockId;
  }

  return "";
}

/**
 * Forgets the id getCurrentCitizenId() stashed, and takes `?citizenId=` off
 * the address bar, so a reload doesn't bring it back; a development mock id
 * stays off too, until an id is given again. The admin dashboard calls this
 * on sign-out.
 */
export function forgetCurrentCitizenId(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(CITIZEN_ID_STORAGE_KEY);
    window.sessionStorage.setItem(CITIZEN_ID_FORGOTTEN_KEY, "1");
  } catch {
    // Nothing was stashed if storage is blocked.
  }
  const url = new URL(window.location.href);
  if (url.searchParams.has("citizenId")) {
    url.searchParams.delete("citizenId");
    window.history.replaceState(window.history.state, "", url);
  }
}

/** What lspd-backend's /api/v1/public/citizens/:citizenId returns for a citizen. */
export interface CitizenIdentity {
  photo: string | null;
  fullName: string;
  citizenId: string;
  dateOfBirth: string | null;
  phoneNumber: string | null;
  fingerprintId: string | null;
}

/**
 * Resolves a citizenId (see getCurrentCitizenId) into the citizen's identity
 * via lspd-backend's public citizen-lookup endpoint.
 */
export async function fetchCitizenIdentity(
  citizenId: string,
  apiUrl: string | undefined = import.meta.env.PUBLIC_LSPD_API_URL,
): Promise<CitizenIdentity> {
  if (!apiUrl) throw new Error("PUBLIC_LSPD_API_URL is not set");
  if (!citizenId) throw new Error("No citizen ID");

  const res = await fetch(`${apiUrl}/api/v1/public/citizens/${encodeURIComponent(citizenId)}`);
  if (!res.ok) {
    throw new Error(`Request failed (${res.status})`);
  }
  const data = (await res.json()) as { citizen: CitizenIdentity };
  return { ...data.citizen, photo: data.citizen.photo ?? null };
}
