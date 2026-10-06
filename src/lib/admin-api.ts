import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";

import {
  createRecord,
  deleteRecord,
  listRecords,
  parseSection,
  updateRecord,
  type RecordChanges,
  type RecordInput,
} from "./records.ts";
import { getSettings, saveSettings } from "./settings.ts";
import { AdminError } from "./validation.ts";

// The JSON API behind the admin dashboard (src/admin/). It reads and writes
// the local database, so it only runs inside `npm run admin` (see
// admin-integration.ts), never in a build. Every answer is
// `{ ok: true, data }` or `{ ok: false, error, code, field?, vars? }`, the
// shape the Apps Script backend used, so the dashboard's handling carries over.
//
//   GET    /admin-api/auth                       check the token
//   GET    /admin-api/records/:section           every record, drafts included
//   POST   /admin-api/records/:section           create one
//   PUT    /admin-api/records/:section/:id       change some of its fields
//   DELETE /admin-api/records/:section/:id
//   GET    /admin-api/settings
//   PUT    /admin-api/settings                   change some of them
//
// Every request carries `Authorization: Bearer <token>`. The token travels in
// a header rather than a cookie, so another website open in the same browser
// can't make the browser send it.

export const ADMIN_API_PATH = "/admin-api";

const MAX_BODY_BYTES = 1_000_000;

export interface AdminApiOptions {
  db: DatabaseSync;
  /** What the dashboard must send. */
  token: string;
  /** Shown on the dashboard, so it's clear which database it edits. */
  databaseName?: string;
  /** Called after every successful change. */
  onChange?: () => void;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function tokenMatches(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

/**
 * The whole body, or a 413 once it passes the limit. An oversized body is
 * read to its end and thrown away (rather than abandoned half way, which
 * would cut the connection before the answer) unless it never stops.
 */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
      else if (size > 10 * MAX_BODY_BYTES) req.destroy();
    });
    req.on("end", () =>
      size > MAX_BODY_BYTES
        ? reject(new AdminError("tooLarge", "The request is too large.", { status: 413 }))
        : resolve(Buffer.concat(chunks)),
    );
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
    throw new AdminError("badRequest", "Send the body as application/json.", { status: 415 });
  }
  let body: unknown;
  try {
    body = JSON.parse((await readBody(req)).toString("utf8"));
  } catch (error) {
    if (error instanceof AdminError) throw error;
    if (error instanceof SyntaxError) throw new AdminError("badRequest", "The body is not valid JSON.");
    throw error;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AdminError("badRequest", "The body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

/** Refuses a request that a page on another origin sent. */
function checkOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  let host = "";
  try {
    host = new URL(origin).host;
  } catch {
    // An origin that isn't a URL ("null") is never ours.
  }
  if (host !== req.headers.host) {
    throw new AdminError("forbidden", "Requests from other sites are not accepted.", { status: 403 });
  }
}

function checkToken(req: IncomingMessage, expected: string): void {
  const header = req.headers.authorization ?? "";
  const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!given || !tokenMatches(given, expected)) {
    throw new AdminError("wrongToken", "The admin token is incorrect.", { status: 401 });
  }
}

/** The request handler for everything under `/admin-api`, for `http.createServer` or Vite's `middlewares.use`. */
export function createAdminApi({ db, token, databaseName = "", onChange }: AdminApiOptions): Handler {
  if (!token) throw new Error("The admin API needs a token.");

  async function route(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    // Connect strips its mount path from `url` and keeps the whole one in `originalUrl`.
    const target = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? "/";
    const { pathname } = new URL(target, "http://localhost");
    if (pathname !== ADMIN_API_PATH && !pathname.startsWith(`${ADMIN_API_PATH}/`)) {
      throw new AdminError("unknownAction", "Not found.", { status: 404 });
    }
    let parts: string[];
    try {
      parts = pathname.slice(ADMIN_API_PATH.length).split("/").filter(Boolean).map(decodeURIComponent);
    } catch {
      throw new AdminError("badRequest", "The address is not valid.");
    }

    checkOrigin(req);
    checkToken(req, token);

    const method = req.method ?? "GET";
    const [resource, sectionName, id, ...rest] = parts;
    if (rest.length > 0) throw new AdminError("unknownAction", "Not found.", { status: 404 });

    if (resource === "auth" && method === "GET" && !sectionName) {
      send(res, 200, { ok: true, data: { authenticated: true, database: databaseName } });
      return false;
    }

    if (resource === "records" && sectionName) {
      const section = parseSection(sectionName);
      if (!id && method === "GET") {
        send(res, 200, { ok: true, data: listRecords(db, section, { includeDrafts: true }) });
        return false;
      }
      if (!id && method === "POST") {
        const record = createRecord(db, section, (await readJson(req)) as RecordInput);
        send(res, 201, { ok: true, data: record });
        return true;
      }
      if (id && method === "PUT") {
        const changes = await readJson(req);
        // The address names the record; an id in the body can't move it.
        delete changes.id;
        send(res, 200, { ok: true, data: updateRecord(db, section, id, changes as RecordChanges) });
        return true;
      }
      if (id && method === "DELETE") {
        deleteRecord(db, section, id);
        send(res, 200, { ok: true, data: { deleted: true, id } });
        return true;
      }
    }

    if (resource === "settings" && !sectionName) {
      if (method === "GET") {
        send(res, 200, { ok: true, data: getSettings(db) });
        return false;
      }
      if (method === "PUT") {
        send(res, 200, { ok: true, data: saveSettings(db, await readJson(req)) });
        return true;
      }
    }

    throw new AdminError("unknownAction", "Not found.", { status: 404 });
  }

  return async (req, res) => {
    let changed = false;
    try {
      changed = await route(req, res);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof AdminError) {
        send(res, error.status, {
          ok: false,
          error: error.message,
          code: error.code,
          ...(error.field ? { field: error.field } : {}),
          ...(error.vars ? { vars: error.vars } : {}),
        });
        return;
      }
      console.error("[admin] request failed:", error);
      send(res, 500, { ok: false, error: "Something went wrong on the server.", code: "serverError" });
      return;
    }
    // The change is saved and answered; a failing hook mustn't undo that.
    if (changed) {
      try {
        onChange?.();
      } catch (error) {
        console.error("[admin] onChange failed:", error);
      }
    }
  };
}
