import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import type { DatabaseSync } from "node:sqlite";

import { ADMIN_API_PATH, createAdminApi } from "./admin-api.ts";
import { addAdmin, removeAdmin } from "./admins.ts";
import { openDb } from "./db.ts";

const CITIZEN = "ABC12345";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

interface Harness {
  db: DatabaseSync;
  base: string;
  /** Changes reported to onChange. */
  changes: number;
  /** What the API told its log. */
  logs: string[];
  /** The session token of the admin `start` signed in. */
  token: string;
  /** The API's clock, which the test moves. */
  clock: { now: number };
  call(method: string, path: string, options?: CallOptions): Promise<{ status: number; body: any; headers: Headers }>;
  /** Signs in as `citizenId` and returns the answer, whatever it is. */
  login(citizenId: unknown, options?: CallOptions): Promise<{ status: number; body: any; headers: Headers }>;
}

interface CallOptions {
  body?: unknown;
  rawBody?: string;
  /** The session token to send; the signed-in admin's unless given, none for null. */
  token?: string | null;
  headers?: Record<string, string>;
}

interface StartOptions {
  /** Serve it the way Vite's connect does, with the mount path stripped from the url. */
  mount?: boolean;
  onChange?: () => void;
  /** Sign in as the test admin (the default). */
  signedIn?: boolean;
  sessionMs?: number;
  maxFailedLogins?: number;
}

/** The API on a real socket and an in-memory database that has one admin on its whitelist. */
async function start({ mount = false, onChange, signedIn = true, sessionMs, maxFailedLogins }: StartOptions = {}): Promise<Harness> {
  const db = openDb(":memory:");
  cleanup.push(() => db.close());
  addAdmin(db, CITIZEN, "Test Admin");

  const harness = { db, changes: 0, logs: [], token: "", clock: { now: 1_000_000 } } as unknown as Harness;
  const handler = createAdminApi({
    db,
    databaseName: "test.db",
    onChange: () => {
      harness.changes += 1;
      onChange?.();
    },
    log: (message) => harness.logs.push(message),
    sessionMs,
    maxFailedLogins,
    now: () => harness.clock.now,
  });
  const server: Server = createServer((req: IncomingMessage & { originalUrl?: string }, res: ServerResponse) => {
    if (mount) {
      req.originalUrl = req.url;
      req.url = (req.url ?? "").slice(ADMIN_API_PATH.length) || "/";
    }
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  server.closeAllConnections?.();

  harness.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  harness.call = async (method, path, { body, rawBody, token = harness.token, headers = {} } = {}) => {
    const response = await fetch(`${harness.base}${ADMIN_API_PATH}${path}`, {
      method,
      headers: {
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        ...(body !== undefined || rawBody !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  harness.login = (citizenId, options = {}) =>
    harness.call("POST", "/login", { body: { citizenId }, token: null, ...options });

  if (signedIn) {
    const { body } = await harness.login(CITIZEN);
    harness.token = body.data.token;
  }
  return harness;
}

const announcement = { title: "Anunsyo", content: "Laman" };

describe("signing in", () => {
  it("lets a whitelisted citizen in, and says who they are", async () => {
    const api = await start({ signedIn: false });
    const { status, body } = await api.login(CITIZEN);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data.admin, { citizenId: CITIZEN, name: "Test Admin" });
    assert.equal(typeof body.data.token, "string");
    assert.ok(body.data.token.length >= 40);
    assert.equal(body.data.expiresAt, api.clock.now + 12 * 60 * 60 * 1000);
    assert.deepEqual(api.logs, [`Test Admin (${CITIZEN}) signed in.`]);

    const auth = await api.call("GET", "/auth", { token: body.data.token });
    assert.deepEqual(auth.body, {
      ok: true,
      data: { authenticated: true, database: "test.db", admin: { citizenId: CITIZEN, name: "Test Admin" } },
    });
  });

  it("finds the citizen however the id is capitalised or padded, and answers with the stored id", async () => {
    const api = await start({ signedIn: false });
    for (const given of ["abc12345", " ABC12345 ", "Abc12345"]) {
      const { status, body } = await api.login(given);
      assert.equal(status, 200, given);
      assert.equal(body.data.admin.citizenId, CITIZEN);
    }
  });

  it("gives each sign-in its own token", async () => {
    const api = await start({ signedIn: false });
    const one = (await api.login(CITIZEN)).body.data.token;
    const two = (await api.login(CITIZEN)).body.data.token;
    assert.notEqual(one, two);
    assert.equal((await api.call("GET", "/auth", { token: one })).status, 200);
    assert.equal((await api.call("GET", "/auth", { token: two })).status, 200);
  });

  it("turns away a citizen who is not on the whitelist, and says so in the log", async () => {
    // Many bad ids from one address: lift the limit that would stop it (tested below).
    const api = await start({ signedIn: false, maxFailedLogins: 100 });
    for (const given of ["ZZZ99999", "ABC1234", "ABC123456", "ABC%", "ABC12345' OR '1'='1"]) {
      const { status, body } = await api.login(given);
      assert.equal(status, 403, JSON.stringify(given));
      assert.equal(body.code, "notWhitelisted");
      assert.equal(body.field, "citizenId");
      assert.equal(body.data, undefined);
    }
    assert.ok(api.logs.every((line) => line.startsWith("Turned away ")));
  });

  it("takes the citizen id as text only, so a list or number can't pass for one", async () => {
    const api = await start({ signedIn: false });
    for (const citizenId of [[CITIZEN], { id: CITIZEN }, [[CITIZEN]], 12345, true, { toString: CITIZEN }]) {
      const { status, body } = await api.login(citizenId);
      assert.equal(status, 400, JSON.stringify(citizenId));
      assert.equal(body.code, "badRequest");
      assert.equal(body.data, undefined);
    }
    assert.equal(api.logs.length, 0);
  });

  it("asks for a citizen id, without counting that against the sender", async () => {
    const api = await start({ signedIn: false, maxFailedLogins: 2 });
    for (const body of [{}, { citizenId: "" }, { citizenId: "   " }, { citizenId: null }]) {
      const answer = await api.call("POST", "/login", { body, token: null });
      assert.equal(answer.status, 400, JSON.stringify(body));
      assert.equal(answer.body.code, "needCitizenId");
    }
    assert.equal((await api.login(CITIZEN)).status, 200);
  });

  it("logs a refused id on one line, whatever it contains", async () => {
    const api = await start({ signedIn: false });
    await api.login("evil\nSigned in as Mayor (ABC12345).");
    assert.equal(api.logs.length, 1);
    assert.ok(!api.logs[0]!.includes("\n"));
    assert.ok(api.logs[0]!.startsWith('Turned away "evil\\nSigned in'));
  });

  it("makes an address that keeps failing wait, then lets it try again", async () => {
    const api = await start({ signedIn: false, maxFailedLogins: 5 });
    for (let i = 0; i < 5; i += 1) assert.equal((await api.login(`NOPE000${i}`)).status, 403);

    // Even the right id is refused while it waits.
    const refused = await api.login(CITIZEN);
    assert.equal(refused.status, 429);
    assert.equal(refused.body.code, "tooManyAttempts");
    assert.equal(refused.body.vars.seconds, 60);
    assert.equal(refused.headers.get("retry-after"), "60");
    assert.equal(api.logs.filter((line) => line.includes("signed in")).length, 0);

    api.clock.now += 59_000;
    assert.equal((await api.login(CITIZEN)).status, 429);
    api.clock.now += 1_001;
    assert.equal((await api.login(CITIZEN)).status, 200);
  });

  it("forgets earlier failures once someone gets in", async () => {
    const api = await start({ signedIn: false, maxFailedLogins: 5 });
    for (let round = 0; round < 3; round += 1) {
      for (let i = 0; i < 4; i += 1) assert.equal((await api.login("NOPE0000")).status, 403);
      assert.equal((await api.login(CITIZEN)).status, 200);
    }
  });

  it("only takes a JSON body, from this dashboard's own origin", async () => {
    const api = await start({ signedIn: false });
    const plain = await fetch(`${api.base}${ADMIN_API_PATH}/login`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ citizenId: CITIZEN }),
    });
    assert.equal(plain.status, 415);

    const other = await api.login(CITIZEN, { headers: { Origin: "https://evil.example" } });
    assert.equal(other.status, 403);
    assert.equal(other.body.code, "forbidden");

    assert.equal((await api.login(CITIZEN, { headers: { Origin: api.base } })).status, 200);
    assert.equal((await api.call("GET", "/login", { token: null })).status, 401);
  });
});

describe("a session", () => {
  it("is needed for every request but signing in, and nothing is read or written without one", async () => {
    const api = await start();
    const requests: [string, string, unknown?][] = [
      ["GET", "/auth"],
      ["POST", "/logout"],
      ["GET", "/records/Announcements"],
      ["POST", "/records/Announcements", announcement],
      ["PUT", "/records/Announcements/x", { title: "T" }],
      ["DELETE", "/records/Announcements/x"],
      ["GET", "/settings"],
      ["PUT", "/settings", { siteTitle: "T" }],
    ];
    for (const [method, path, body] of requests) {
      // The citizen id itself is no use as a token, nor is anything close to the real one.
      for (const token of [null, "", "wrong", CITIZEN, `${api.token}x`, api.token.slice(1)]) {
        const { status, body: answer } = await api.call(method, path, { body, token });
        assert.equal(status, 401, `${method} ${path} with ${JSON.stringify(token)}`);
        assert.deepEqual(answer, { ok: false, error: "Sign in again.", code: "sessionExpired" });
      }
    }
    assert.equal(Number(api.db.prepare("SELECT count(*) AS n FROM records").get()!.n), 0);
    assert.equal(api.changes, 0);
  });

  it("is accepted from a header only, not a query string", async () => {
    const api = await start();
    const response = await fetch(`${api.base}${ADMIN_API_PATH}/auth?token=${api.token}`);
    assert.equal(response.status, 401);
  });

  it("ends when the citizen signs out", async () => {
    const api = await start();
    const other = (await api.login(CITIZEN)).body.data.token;

    const out = await api.call("POST", "/logout");
    assert.deepEqual(out.body, { ok: true, data: { signedOut: true } });
    assert.equal((await api.call("GET", "/auth")).status, 401);
    assert.equal((await api.call("GET", "/auth", { token: other })).status, 200);
    assert.ok(api.logs.includes(`Test Admin (${CITIZEN}) signed out.`));
  });

  it("runs out after the time it was given", async () => {
    const api = await start({ sessionMs: 60_000 });
    api.clock.now += 59_999;
    assert.equal((await api.call("GET", "/auth")).status, 200);
    api.clock.now += 2;
    const { status, body } = await api.call("GET", "/auth");
    assert.equal(status, 401);
    assert.equal(body.code, "sessionExpired");
  });

  it("ends the moment the citizen is taken off the whitelist", async () => {
    const api = await start();
    assert.equal((await api.call("GET", "/records/Announcements")).status, 200);

    removeAdmin(api.db, CITIZEN);
    assert.equal((await api.call("GET", "/records/Announcements")).status, 401);
    assert.equal((await api.call("POST", "/records/Announcements", { body: announcement })).status, 401);

    // Putting them back doesn't bring the old session back; they sign in again.
    addAdmin(api.db, CITIZEN, "Test Admin");
    assert.equal((await api.call("GET", "/auth")).status, 401);
    assert.equal((await api.login(CITIZEN)).status, 200);
  });

  it("follows a rename on the whitelist", async () => {
    const api = await start();
    api.db.prepare("UPDATE site_admins SET name = 'New Name'").run();
    assert.equal((await api.call("GET", "/auth")).body.data.admin.name, "New Name");
  });

  it("is lost when the server restarts, because sessions live in memory", async () => {
    const first = await start();
    const second = await start({ signedIn: false });
    assert.equal((await second.call("GET", "/auth", { token: first.token })).status, 401);
  });
});

describe("records", () => {
  it("are created, listed, changed and deleted", async () => {
    const api = await start();

    const created = await api.call("POST", "/records/Announcements", { body: { ...announcement, published: true } });
    assert.equal(created.status, 201);
    assert.equal(created.body.ok, true);
    const id: string = created.body.data.id;
    assert.equal(created.body.data.title, "Anunsyo");

    const listed = await api.call("GET", "/records/Announcements");
    assert.deepEqual(listed.body.data.map((r: { id: string }) => r.id), [id]);

    const changed = await api.call("PUT", `/records/Announcements/${id}`, { body: { title: "Binago", id: "ignored" } });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.data.id, id);
    assert.equal(changed.body.data.title, "Binago");
    assert.equal(changed.body.data.content, "Laman");

    const deleted = await api.call("DELETE", `/records/Announcements/${id}`);
    assert.deepEqual(deleted.body, { ok: true, data: { deleted: true, id } });
    assert.deepEqual((await api.call("GET", "/records/Announcements")).body.data, []);
  });

  it("list drafts too, as the dashboard needs", async () => {
    const api = await start();
    await api.call("POST", "/records/Announcements", { body: announcement });
    const { body } = await api.call("GET", "/records/Announcements");
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].published, false);
  });

  it("keep an id with characters that need escaping in an address", async () => {
    const api = await start();
    const id = "a b/c?d#é";
    await api.call("POST", "/records/Announcements", { body: { ...announcement, id } });
    const changed = await api.call("PUT", `/records/Announcements/${encodeURIComponent(id)}`, { body: { title: "T" } });
    assert.equal(changed.body.data.id, id);
    assert.equal((await api.call("DELETE", `/records/Announcements/${encodeURIComponent(id)}`)).status, 200);
  });

  it("are numbered when a numbered document is published", async () => {
    const api = await start();
    const { body } = await api.call("POST", "/records/Resolutions", {
      body: { title: "R", content: "c", date: "2026-05-01", published: true },
    });
    assert.equal(body.data.number, "Resolusyon Blg. 01, Serye ng 2026");
    assert.equal(body.data.publicationSequence, 1);
  });

  it("answer a refused change with its code, field and values for the dashboard", async () => {
    const api = await start();
    let result = await api.call("POST", "/records/Announcements", { body: { content: "c" } });
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { ok: false, error: "A title is required.", code: "needTitle", field: "title" });

    result = await api.call("POST", "/records/Announcements", { body: { title: "T", content: "c", pinned: true, pinOrder: 7 } });
    assert.equal(result.body.code, "badPinOrder");
    assert.deepEqual(result.body.vars, { max: 3 });

    result = await api.call("POST", "/records/Forms", { body: { title: "F", url: "javascript:alert(1)" } });
    assert.equal(result.body.code, "badUrl");
    assert.equal(result.body.field, "url");
    assert.equal(api.changes, 0);
  });

  it("say when there is no such record, section, or id taken", async () => {
    const api = await start();
    assert.equal((await api.call("PUT", "/records/Announcements/nope", { body: { title: "T" } })).status, 404);
    assert.equal((await api.call("PUT", "/records/Announcements/nope", { body: { title: "T" } })).body.code, "recordNotFound");
    assert.equal((await api.call("DELETE", "/records/Announcements/nope")).status, 404);

    const badSection = await api.call("GET", "/records/Settings");
    assert.equal(badSection.status, 400);
    assert.equal(badSection.body.code, "badSection");

    await api.call("POST", "/records/Announcements", { body: { ...announcement, id: "dup" } });
    const duplicate = await api.call("POST", "/records/Announcements", { body: { ...announcement, id: "dup" } });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, "idTaken");
  });
});

describe("settings", () => {
  it("are read with the defaults filled in, and changed a few at a time", async () => {
    const api = await start();
    const before = (await api.call("GET", "/settings")).body.data;
    assert.equal(before.siteTitle, "Los Santos eGov");

    const saved = await api.call("PUT", "/settings", { body: { siteTitle: "Bago", logoUrl: "https://example.com/l.png" } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.data, { ...before, siteTitle: "Bago", logoUrl: "https://example.com/l.png" });
    assert.deepEqual((await api.call("GET", "/settings")).body.data, saved.body.data);
  });

  it("refuse a bad link", async () => {
    const api = await start();
    const { status, body } = await api.call("PUT", "/settings", { body: { meetingUrl: "javascript:1" } });
    assert.equal(status, 400);
    assert.equal(body.code, "badUrl");
    assert.equal(body.field, "meetingUrl");
  });
});

describe("a bad request", () => {
  it("must be JSON, and an object", async () => {
    const api = await start();
    const notJson = await fetch(`${api.base}${ADMIN_API_PATH}/records/Announcements`, {
      method: "POST",
      headers: { Authorization: `Bearer ${api.token}`, "Content-Type": "text/plain" },
      body: JSON.stringify(announcement),
    });
    assert.equal(notJson.status, 415);

    const broken = await api.call("POST", "/records/Announcements", { rawBody: "{nope" });
    assert.equal(broken.status, 400);
    assert.equal(broken.body.code, "badRequest");

    for (const rawBody of ["[]", "null", '"text"', "12"]) {
      assert.equal((await api.call("POST", "/records/Announcements", { rawBody })).status, 400, rawBody);
    }
  });

  it("is refused when it is too large", async () => {
    const api = await start();
    const { status, body } = await api.call("POST", "/records/Announcements", {
      rawBody: JSON.stringify({ ...announcement, content: "x".repeat(1_200_000) }),
    });
    assert.equal(status, 413);
    assert.equal(body.code, "tooLarge");
  });

  it("gets a 404 for an address that isn't one, and a bad escape is a 400", async () => {
    const api = await start();
    assert.equal((await api.call("GET", "/nothing")).status, 404);
    assert.equal((await api.call("GET", "/records")).status, 404);
    assert.equal((await api.call("GET", "/records/Forms/a/b")).status, 404);
    assert.equal((await api.call("PATCH", "/records/Forms/a", { body: {} })).status, 404);
    assert.equal((await api.call("GET", "/%E0%A4%A")).status, 400);
  });
});

describe("a request from another site", () => {
  it("is refused even with a session, and one from the dashboard's own origin is not", async () => {
    const api = await start();
    for (const origin of ["https://evil.example", "http://127.0.0.1:1", "null"]) {
      const { status, body } = await api.call("POST", "/records/Announcements", { body: announcement, headers: { Origin: origin } });
      assert.equal(status, 403, origin);
      assert.equal(body.code, "forbidden");
    }
    assert.equal(Number(api.db.prepare("SELECT count(*) AS n FROM records").get()!.n), 0);

    const own = await api.call("POST", "/records/Announcements", { body: announcement, headers: { Origin: api.base } });
    assert.equal(own.status, 201);
  });
});

describe("onChange", () => {
  it("runs after a change that was saved, and only then", async () => {
    const api = await start();
    await api.call("GET", "/records/Announcements");
    await api.call("GET", "/settings");
    await api.call("POST", "/records/Announcements", { body: { content: "no title" } });
    assert.equal(api.changes, 0);

    const { body } = await api.call("POST", "/records/Announcements", { body: announcement });
    assert.equal(api.changes, 1);
    await api.call("PUT", `/records/Announcements/${body.data.id}`, { body: { title: "T" } });
    await api.call("PUT", "/settings", { body: { siteTitle: "T" } });
    await api.call("DELETE", `/records/Announcements/${body.data.id}`);
    assert.equal(api.changes, 4);
  });

  it("can fail without undoing the change or the answer", async () => {
    const original = console.error;
    console.error = () => {};
    cleanup.push(() => {
      console.error = original;
    });
    const api = await start({
      onChange: () => {
        throw new Error("hook failed");
      },
    });
    const { status, body } = await api.call("POST", "/records/Announcements", { body: announcement });
    assert.equal(status, 201);
    assert.equal(body.ok, true);
    assert.equal((await api.call("GET", "/records/Announcements")).body.data.length, 1);
  });
});

describe("when mounted in a dev server", () => {
  it("works with the mount path stripped from the url, as connect does", async () => {
    const api = await start({ mount: true });
    assert.equal((await api.call("GET", "/auth")).status, 200);
    const created = await api.call("POST", "/records/Announcements", { body: announcement });
    assert.equal(created.status, 201);
    assert.equal((await api.call("GET", "/records/Announcements")).body.data.length, 1);
  });
});
