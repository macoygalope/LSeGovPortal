import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import type { DatabaseSync } from "node:sqlite";

import { ADMIN_API_PATH, createAdminApi } from "./admin-api.ts";
import { openDb } from "./db.ts";

const TOKEN = "a-long-enough-test-token";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

interface Harness {
  db: DatabaseSync;
  base: string;
  changes: number;
  call(method: string, path: string, options?: CallOptions): Promise<{ status: number; body: any }>;
}

interface CallOptions {
  body?: unknown;
  rawBody?: string;
  token?: string | null;
  headers?: Record<string, string>;
}

/** The API on a real socket and an in-memory database. `mount` serves it the way Vite's connect does. */
async function start({ mount = false, onChange }: { mount?: boolean; onChange?: () => void } = {}): Promise<Harness> {
  const db = openDb(":memory:");
  cleanup.push(() => db.close());

  const harness = { db, changes: 0 } as Harness;
  const handler = createAdminApi({
    db,
    token: TOKEN,
    databaseName: "test.db",
    onChange: () => {
      harness.changes += 1;
      onChange?.();
    },
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
  harness.call = async (method, path, { body, rawBody, token = TOKEN, headers = {} } = {}) => {
    const response = await fetch(`${harness.base}${ADMIN_API_PATH}${path}`, {
      method,
      headers: {
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        ...(body !== undefined || rawBody !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    return { status: response.status, body: await response.json() };
  };
  return harness;
}

const announcement = { title: "Anunsyo", content: "Laman" };

describe("the token", () => {
  it("is needed for every request, and nothing is read or written without it", async () => {
    const api = await start();
    const requests: [string, string, unknown?][] = [
      ["GET", "/auth"],
      ["GET", "/records/Announcements"],
      ["POST", "/records/Announcements", announcement],
      ["PUT", "/records/Announcements/x", { title: "T" }],
      ["DELETE", "/records/Announcements/x"],
      ["GET", "/settings"],
      ["PUT", "/settings", { siteTitle: "T" }],
    ];
    for (const [method, path, body] of requests) {
      for (const token of [null, "", "wrong", `${TOKEN}x`, TOKEN.slice(1)]) {
        const { status, body: answer } = await api.call(method, path, { body, token });
        assert.equal(status, 401, `${method} ${path} with ${JSON.stringify(token)}`);
        assert.deepEqual(answer, { ok: false, error: "The admin token is incorrect.", code: "wrongToken" });
      }
    }
    assert.equal(Number(api.db.prepare("SELECT count(*) AS n FROM records").get()!.n), 0);
    assert.equal(api.changes, 0);
  });

  it("is accepted from a header only, not a query string", async () => {
    const api = await start();
    const response = await fetch(`${api.base}${ADMIN_API_PATH}/auth?token=${TOKEN}`);
    assert.equal(response.status, 401);
  });

  it("is checked, and the database is named, on /auth", async () => {
    const api = await start();
    const { status, body } = await api.call("GET", "/auth");
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, data: { authenticated: true, database: "test.db" } });
  });

  it("is required to start the API at all", () => {
    assert.throws(() => createAdminApi({ db: openDb(":memory:"), token: "" }), /needs a token/);
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
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "text/plain" },
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
  it("is refused even with the token, and one from the dashboard's own origin is not", async () => {
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
