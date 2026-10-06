import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";

import { getAdmin, normalizeCitizenId, type SiteAdmin } from "./admins.ts";
import { createLoginLimiter, createSessions } from "./admin-auth.ts";
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
//   POST   /admin-api/login                      { citizenId } -> a session token
//   POST   /admin-api/logout
//   GET    /admin-api/auth                       who the session belongs to
//   GET    /admin-api/records/:section           every record, drafts included
//   POST   /admin-api/records/:section           create one
//   PUT    /admin-api/records/:section/:id       change some of its fields
//   DELETE /admin-api/records/:section/:id
//   GET    /admin-api/settings
//   PUT    /admin-api/settings                   change some of them
//
// Who may sign in is the `site_admins` whitelist (admins.ts). Every other
// request carries `Authorization: Bearer <session token>`, which travels in a
// header rather than a cookie, so another website open in the same browser
// can't make the browser send it. A session is checked against the whitelist
// on every request, so taking someone off it signs them out at once.
//
// Mind what the whitelist is: the citizenid is something the caller *says*
// (the game puts it on the kiosk's URL), and a citizenid isn't secret: it is
// printed on the identity card the kiosk shows. Anyone who can reach this
// server and knows an admin's citizenid can sign in as them. The server
// listens on this machine only unless asked otherwise (scripts/admin.mjs),
// and failed sign-ins are rate limited, but that is all that stands between
// a stranger and the dashboard if it is exposed.

export const ADMIN_API_PATH = "/admin-api";

const MAX_BODY_BYTES = 1_000_000;

export interface AdminApiOptions {
  db: DatabaseSync;
  /** Shown on the dashboard, so it's clear which database it edits. */
  databaseName?: string;
  /** Called after every successful change. */
  onChange?: () => void;
  /** Told when someone signs in or out, or is turned away. */
  log?: (message: string) => void;
  /** How long a sign-in lasts. */
  sessionMs?: number;
  /** Failed sign-ins one address may make within `failedLoginWindowMs` before it is made to wait. */
  maxFailedLogins?: number;
  failedLoginWindowMs?: number;
  /** The clock, for tests. */
  now?: () => number;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

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

function bearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

function publicAdmin(admin: SiteAdmin): { citizenId: string; name: string } {
  return { citizenId: admin.citizenId, name: admin.name };
}

/** The request handler for everything under `/admin-api`, for `http.createServer` or Vite's `middlewares.use`. */
export function createAdminApi({
  db,
  databaseName = "",
  onChange,
  log = () => {},
  sessionMs,
  maxFailedLogins,
  failedLoginWindowMs,
  now = Date.now,
}: AdminApiOptions): Handler {
  const sessions = createSessions({ ttlMs: sessionMs, now });
  const limiter = createLoginLimiter({ max: maxFailedLogins, windowMs: failedLoginWindowMs, now });

  /** The signed-in admin for this request, or a 401. */
  function requireAdmin(req: IncomingMessage): { token: string; admin: SiteAdmin } {
    const token = bearerToken(req);
    const session = token ? sessions.find(token) : undefined;
    // Someone taken off the whitelist since they signed in is signed out now.
    const admin = session && getAdmin(db, session.citizenId);
    if (!admin) {
      if (token) sessions.end(token);
      throw new AdminError("sessionExpired", "Sign in again.", { status: 401 });
    }
    return { token, admin };
  }

  async function login(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const address = req.socket.remoteAddress ?? "";
    const wait = limiter.retryAfter(address);
    if (wait > 0) {
      res.setHeader("Retry-After", String(wait));
      throw new AdminError("tooManyAttempts", "Too many failed sign-ins. Try again shortly.", {
        status: 429,
        vars: { seconds: wait },
      });
    }

    // Text only: String(["ABC12345"]) is "ABC12345", and a list must not pass for an id.
    const given = (await readJson(req)).citizenId;
    if (given !== undefined && given !== null && typeof given !== "string") {
      throw new AdminError("badRequest", "The citizen ID must be text.", { field: "citizenId" });
    }
    const citizenId = normalizeCitizenId(given);
    if (!citizenId) throw new AdminError("needCitizenId", "A citizen ID is required.", { field: "citizenId" });

    const admin = getAdmin(db, citizenId);
    if (!admin) {
      limiter.fail(address);
      log(`Turned away ${JSON.stringify(citizenId.slice(0, 64))}: not a site admin.`);
      throw new AdminError("notWhitelisted", "That citizen ID is not on the site-admin list.", {
        status: 403,
        field: "citizenId",
      });
    }

    limiter.clear(address);
    const { token, expiresAt } = sessions.start(admin.citizenId);
    log(`${admin.name} (${admin.citizenId}) signed in.`);
    send(res, 200, { ok: true, data: { token, expiresAt, admin: publicAdmin(admin) } });
  }

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

    const method = req.method ?? "GET";
    const [resource, sectionName, id, ...rest] = parts;
    if (rest.length > 0) throw new AdminError("unknownAction", "Not found.", { status: 404 });

    // The one request that doesn't need a session: it is how you get one.
    if (resource === "login" && method === "POST" && !sectionName) {
      await login(req, res);
      return false;
    }

    const { token, admin } = requireAdmin(req);

    if (resource === "logout" && method === "POST" && !sectionName) {
      sessions.end(token);
      log(`${admin.name} (${admin.citizenId}) signed out.`);
      send(res, 200, { ok: true, data: { signedOut: true } });
      return false;
    }

    if (resource === "auth" && method === "GET" && !sectionName) {
      send(res, 200, {
        ok: true,
        data: { authenticated: true, database: databaseName, admin: publicAdmin(admin) },
      });
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
