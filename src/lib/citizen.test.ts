import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { devMockCitizenId, fetchCitizenIdentity, forgetCurrentCitizenId, getCurrentCitizenId } from "./citizen.ts";

const globals = globalThis as Record<string, unknown>;

/** Stands in for the browser: a URL query string and a sessionStorage. */
function browser(search: string, stored: Record<string, string> = {}, storageWorks = true) {
  globals.window = {
    location: { search },
    sessionStorage: {
      getItem(key: string) {
        if (!storageWorks) throw new Error("blocked");
        return stored[key] ?? null;
      },
      setItem(key: string, value: string) {
        if (!storageWorks) throw new Error("blocked");
        stored[key] = value;
      },
    },
  };
  return stored;
}

afterEach(() => {
  delete globals.window;
  delete globals.fetch;
});

describe("getCurrentCitizenId", () => {
  it("reads the id the kiosk puts on the URL and keeps it for later pages", () => {
    const stored = browser("?citizenId=ABC12345");
    assert.equal(getCurrentCitizenId(), "ABC12345");

    // The next page has no query string; the stashed id is still there.
    browser("", stored);
    assert.equal(getCurrentCitizenId(), "ABC12345");
  });

  it("prefers the URL over a stale stashed id", () => {
    const stored = browser("?citizenId=NEW00001", { "lsegov-portal:citizenId": "OLD00001" });
    assert.equal(getCurrentCitizenId(), "NEW00001");
    assert.equal(stored["lsegov-portal:citizenId"], "NEW00001");
  });

  it("returns an empty string outside the game", () => {
    browser("");
    assert.equal(getCurrentCitizenId(), "");
  });

  it("still returns the URL's id when sessionStorage is blocked", () => {
    browser("?citizenId=ABC12345", {}, false);
    assert.equal(getCurrentCitizenId(), "ABC12345");

    browser("", {}, false);
    assert.equal(getCurrentCitizenId(), "");
  });

  it("returns an empty string without a window", () => {
    assert.equal(getCurrentCitizenId(), "");
    assert.equal(getCurrentCitizenId("MOCK0001"), "");
  });
});

describe("the development mock citizen", () => {
  it("stands in when the browser has no id", () => {
    browser("");
    assert.equal(getCurrentCitizenId("MOCK0001"), "MOCK0001");
    // It is a fallback, not something stashed for later: nothing is written.
    const stored = browser("");
    getCurrentCitizenId("MOCK0001");
    assert.deepEqual(stored, {});
  });

  it("gives way to an id on the URL, and to one stashed from an earlier page", () => {
    browser("?citizenId=REAL0001");
    assert.equal(getCurrentCitizenId("MOCK0001"), "REAL0001");

    browser("", { "lsegov-portal:citizenId": "REAL0002" });
    assert.equal(getCurrentCitizenId("MOCK0001"), "REAL0002");
  });

  it("stays out of the way once the citizen was forgotten, until an id is given again", () => {
    browser("", { "lsegov-portal:citizenIdForgotten": "1" });
    assert.equal(getCurrentCitizenId("MOCK0001"), "");

    const stored = browser("?citizenId=REAL0001", { "lsegov-portal:citizenIdForgotten": "1" });
    (globalThis as { window?: { sessionStorage: { removeItem?: (key: string) => void } } }).window!.sessionStorage.removeItem = (key) => {
      delete stored[key];
    };
    assert.equal(getCurrentCitizenId("MOCK0001"), "REAL0001");
    assert.equal(stored["lsegov-portal:citizenIdForgotten"], undefined);
  });

  it("is used when sessionStorage is blocked, since there is nothing to forget it in", () => {
    browser("", {}, false);
    assert.equal(getCurrentCitizenId("MOCK0001"), "MOCK0001");
  });

  it("is not configured outside development: plain Node has no import.meta.env, and a build has DEV off", () => {
    assert.equal(devMockCitizenId(), "");
    browser("");
    assert.equal(getCurrentCitizenId(), "");
  });
});

describe("forgetCurrentCitizenId", () => {
  /** A browser that also remembers what replaceState was asked to show. */
  function browserAt(href: string, stored: Record<string, string>) {
    browser("", stored);
    const win = globals.window as { location: { href: string; search: string }; history: object; sessionStorage: object };
    win.location.href = href;
    win.location.search = new URL(href).search;
    const shown: string[] = [];
    win.history = { state: null, replaceState: (_state: unknown, _title: string, url: URL) => shown.push(String(url)) };
    (win.sessionStorage as { removeItem?: (key: string) => void }).removeItem = (key) => {
      delete stored[key];
    };
    return shown;
  }

  it("clears the stashed id and takes the id off the address", () => {
    const stored = { "lsegov-portal:citizenId": "ABC12345" };
    const shown = browserAt("http://localhost:4322/admin?citizenId=ABC12345&x=1", stored);
    forgetCurrentCitizenId();
    // The id is gone, and a note says it was forgotten on purpose (so a dev mock stays off).
    assert.deepEqual(stored, { "lsegov-portal:citizenIdForgotten": "1" });
    assert.deepEqual(shown, ["http://localhost:4322/admin?x=1"]);
  });

  it("leaves an address without an id alone", () => {
    const shown = browserAt("http://localhost:4322/admin", {});
    forgetCurrentCitizenId();
    assert.deepEqual(shown, []);
  });

  it("does nothing without a window", () => {
    assert.doesNotThrow(() => forgetCurrentCitizenId());
  });
});

describe("fetchCitizenIdentity", () => {
  const citizen = {
    photo: null,
    fullName: "Jane Doe",
    citizenId: "ABC12345",
    dateOfBirth: "1990-01-01",
    phoneNumber: "555-0100",
    fingerprintId: "FP-1",
  };

  it("looks the citizen up on lspd-backend, encoding the id", async () => {
    const requested: string[] = [];
    globals.fetch = async (url: string) => {
      requested.push(url);
      return { ok: true, json: async () => ({ citizen }) };
    };

    const result = await fetchCitizenIdentity("A B/1", "http://localhost:8080");
    assert.deepEqual(requested, ["http://localhost:8080/api/v1/public/citizens/A%20B%2F1"]);
    assert.deepEqual(result, citizen);
  });

  it("turns a missing photo into null", async () => {
    const { photo: _photo, ...withoutPhoto } = citizen;
    globals.fetch = async () => ({ ok: true, json: async () => ({ citizen: withoutPhoto }) });
    assert.equal((await fetchCitizenIdentity("ABC12345", "http://x")).photo, null);
  });

  it("fails with the status when the citizen is not found", async () => {
    globals.fetch = async () => ({ ok: false, status: 404 });
    await assert.rejects(fetchCitizenIdentity("NOPE", "http://x"), { message: "Request failed (404)" });
  });

  it("fails without a request when there is no id or no API URL", async () => {
    globals.fetch = async () => assert.fail("must not be requested");
    await assert.rejects(fetchCitizenIdentity("", "http://x"), { message: "No citizen ID" });
    await assert.rejects(fetchCitizenIdentity("ABC12345", ""), { message: "PUBLIC_LSPD_API_URL is not set" });
  });
});
