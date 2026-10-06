import type { DatabaseSync } from "node:sqlite";

import { toText } from "./normalize.ts";
import { AdminError, checkLength } from "./validation.ts";

// The whitelist for the admin dashboard: the `site_admins` table. A citizen
// is let in when their citizenid is on it. Nothing here proves who is asking:
// see admin-api.ts for what the check does and doesn't protect.

export interface SiteAdmin {
  citizenId: string;
  /** Who this is, for the dashboard and for whoever reads the list. */
  name: string;
  createdAt: string;
}

const MAX_CITIZEN_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 160;

function toAdmin(row: Record<string, unknown>): SiteAdmin {
  return { citizenId: String(row.citizenid), name: String(row.name), createdAt: String(row.created_at) };
}

/** A citizenid as typed or read from a URL: no spaces around it, and none inside. */
export function normalizeCitizenId(value: unknown): string {
  return toText(value);
}

/** The citizen on the whitelist with that id (however it is capitalised), or undefined. */
export function getAdmin(db: DatabaseSync, citizenId: unknown): SiteAdmin | undefined {
  const id = normalizeCitizenId(citizenId);
  if (!id) return undefined;
  const row = db.prepare("SELECT citizenid, name, created_at FROM site_admins WHERE citizenid = ?").get(id);
  return row && toAdmin(row);
}

/** Everyone on the whitelist, in the order they were added. */
export function listAdmins(db: DatabaseSync): SiteAdmin[] {
  return db
    .prepare("SELECT citizenid, name, created_at FROM site_admins ORDER BY created_at, rowid")
    .all()
    .map(toAdmin);
}

/** Adds a citizen to the whitelist. Throws if they are already on it. */
export function addAdmin(db: DatabaseSync, citizenId: unknown, name: unknown): SiteAdmin {
  const id = normalizeCitizenId(citizenId);
  const label = toText(name);
  if (!id) throw new AdminError("needCitizenId", "A citizen ID is required.", { field: "citizenId" });
  if (/\s/.test(id)) {
    throw new AdminError("badCitizenId", "A citizen ID has no spaces in it.", { field: "citizenId" });
  }
  if (!label) throw new AdminError("needAdminName", "A name is required.", { field: "name" });
  checkLength("citizenId", id, MAX_CITIZEN_ID_LENGTH);
  checkLength("name", label, MAX_NAME_LENGTH);

  const { changes } = db
    .prepare("INSERT INTO site_admins (citizenid, name) VALUES (?, ?) ON CONFLICT (citizenid) DO NOTHING")
    .run(id, label);
  if (Number(changes) === 0) {
    throw new AdminError("adminExists", `"${id}" is already a site admin.`, { status: 409, field: "citizenId" });
  }
  return getAdmin(db, id)!;
}

/** Takes a citizen off the whitelist. Throws if they weren't on it. */
export function removeAdmin(db: DatabaseSync, citizenId: unknown): void {
  const id = normalizeCitizenId(citizenId);
  const { changes } = db.prepare("DELETE FROM site_admins WHERE citizenid = ?").run(id);
  if (Number(changes) === 0) {
    throw new AdminError("adminNotFound", `"${id}" is not a site admin.`, { status: 404, field: "citizenId" });
  }
}
