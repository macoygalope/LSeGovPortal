// The site bundle: one .zip holding everything a server needs to deploy this site,
//
//   site.json   what it is (the slug, the name, what the zip holds)
//   content/    the kiosk build (npm run build:kiosk), index.html at content/index.html
//   site.db     the public copy of the database (npm run site:build)
//
// content/ and site.db are each optional (a bundle can carry only one). `npm run
// site:pack` makes it; `npm run deploy` sends it over SSH; or it is handed to whoever
// runs the server, who drops it on deploy-site-staging.cmd / deploy-site-production.cmd.
// All of those end in prestige-nginx's deploy-site.ps1, which unpacks it, refuses
// anything unexpected and deploys it. The rules below are the same ones that script
// enforces (BUNDLE_FORMAT and the limits must match it), so a mistake is caught here,
// on this machine, before a file is sent anywhere.
//
// The zip is written by hand (a few dozen lines, no dependency): Node can inflate and
// hash but has no zip writer. It is checked against the real extractor, .NET's, by
// deploy-site.test.ps1 and by the rehearsal, and against a reader in the test here.

import { createHash } from "node:crypto";
import { lstatSync, openSync, readFileSync, readSync, readdirSync, closeSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

import { PUBLIC_COPY_APPLICATION_ID } from "./public-db.ts";

export const BUNDLE_FORMAT = 1;
/** deploy-site.ps1 refuses a bundle past either limit: a site is megabytes. */
export const MAX_BUNDLE_ENTRIES = 5000;
export const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;
/** The same pattern lspd-backend and deploy-site.ps1 use for a site's slug. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export type BundlePart = "content" | "data";

export interface BundleManifest {
  format: number;
  slug: string;
  name: string;
  type: "static" | "dynamic";
  /** Ask the server to (re)register the site in lspd-backend's catalog. First deploy of a site only. */
  register: boolean;
  includes: BundlePart[];
  builtAt: string;
}

export interface ZipEntry {
  /** Forward slashes, no leading slash. */
  path: string;
  data: Uint8Array;
}

export interface PackOptions {
  slug: string;
  name: string;
  type?: "static" | "dynamic";
  register?: boolean;
  /** The built site, e.g. dist/. */
  contentDir?: string;
  /** The public copy of the database made by `npm run site:build`. */
  dataFile?: string;
  builtAt?: Date;
}

export interface PackedBundle {
  zip: Buffer;
  manifest: BundleManifest;
  sha256: string;
  /** Files in content/. */
  contentFiles: number;
}

/** A name deploy-site.ps1 would refuse: it could not be unpacked safely on Windows. */
export function isUnsafeSegment(segment: string): boolean {
  return (
    segment === "" ||
    segment === "." ||
    segment === ".." ||
    /[:*?"<>|\u0000-\u001f]/.test(segment) ||
    segment.endsWith(".") ||
    segment.endsWith(" ")
  );
}

/** Databases never go in a site's served folder, sidecar files included. */
export function isDatabaseFileName(name: string): boolean {
  let lower = name.toLowerCase();
  for (const sidecar of ["-journal", "-wal", "-shm"]) {
    if (lower.endsWith(sidecar)) lower = lower.slice(0, -sidecar.length);
  }
  return [".db", ".sqlite", ".sqlite3"].some((ext) => lower.endsWith(ext));
}

export function createManifest(options: {
  slug: string;
  name: string;
  type: "static" | "dynamic";
  register: boolean;
  includes: BundlePart[];
  builtAt: Date;
}): BundleManifest {
  if (!SLUG_PATTERN.test(options.slug)) {
    throw new Error(`'${options.slug}' is not a valid site slug: lowercase letters, digits and hyphens, not starting or ending with a hyphen.`);
  }
  if (options.name.length === 0 || options.name.length > 100 || /[\u0000-\u001f]/.test(options.name)) {
    throw new Error("The site name must be 1 to 100 characters, with no control characters.");
  }
  if (options.includes.length === 0) throw new Error("A bundle has to hold the content, the database or both.");
  return {
    format: BUNDLE_FORMAT,
    slug: options.slug,
    name: options.name,
    type: options.type,
    register: options.register,
    includes: [...new Set(options.includes)].sort() as BundlePart[],
    builtAt: options.builtAt.toISOString(),
  };
}

/**
 * The files of a built site as bundle entries (content/...), after the same checks the
 * server makes: an index.html at the top, no top-level storage folder (where a site's
 * uploads live on the server), no database anywhere, nothing with an unsafe name.
 */
export function readContentFiles(dir: string): ZipEntry[] {
  let top: ReturnType<typeof lstatSync>;
  try {
    top = lstatSync(dir);
  } catch {
    throw new Error(`The built site '${dir}' does not exist. Run: npm run build:kiosk`);
  }
  if (!top.isDirectory()) throw new Error(`The built site '${dir}' is not a folder.`);

  const found: ZipEntry[] = [];
  const walk = (folder: string, prefix: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isUnsafeSegment(entry.name)) throw new Error(`'${relative}' in the built site has a name that cannot be deployed to Windows.`);
      if (prefix === "" && entry.name.toLowerCase() === "storage") {
        throw new Error("The built site has a top-level 'storage' folder, which is where a site's uploads live on the server and is never deployed. Rename it.");
      }
      const full = join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`'${relative}' in the built site is a link; a bundle holds real files only.`);
      if (entry.isDirectory()) {
        walk(full, relative);
      } else if (entry.isFile()) {
        if (isDatabaseFileName(entry.name)) {
          throw new Error(`'${relative}' in the built site is a database file. Everything in a site's folder is served to the public; databases go in as site.db only.`);
        }
        found.push({ path: `content/${relative}`, data: readFileSync(full) });
      }
    }
  };
  walk(dir, "");

  if (!found.some((file) => file.path === "content/index.html")) {
    throw new Error(`The built site '${dir}' has no index.html at its top, so it does not look like a built site.`);
  }
  return found;
}

/** The public copy's bytes, after checking it really is one (see public-db.ts's application id). */
export function readPublicCopy(file: string): Buffer {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    throw new Error(`The database copy '${file}' does not exist. Build it with: npm run site:build -- --out ${file}`);
  }
  const header = Buffer.alloc(100);
  let read: number;
  try {
    read = readSync(fd, header, 0, 100, 0);
  } finally {
    closeSync(fd);
  }
  if (read < 72 || header.toString("latin1", 0, 15) !== "SQLite format 3" || header[15] !== 0) {
    throw new Error(`'${file}' is not a SQLite database.`);
  }
  if (header.readUInt32BE(68) !== PUBLIC_COPY_APPLICATION_ID) {
    throw new Error(
      `'${file}' is not a public copy made by 'npm run site:build'. Putting the database that is edited on a server would publish drafts and the admin list.`,
    );
  }
  return readFileSync(file);
}

/** A zip's DOS date and time fields, in local time (the format has nothing else). */
function dosDateTime(when: Date): { date: number; time: number } {
  const year = Math.max(when.getFullYear(), 1980);
  return {
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
  };
}

/**
 * A zip file: each entry deflated (or stored if that is no smaller), names flagged UTF-8,
 * no zip64 (a site never nears 4 GB). Entries go in the order given.
 */
export function createZip(entries: ZipEntry[], when: Date = new Date()): Buffer {
  if (entries.length === 0) throw new Error("A zip needs at least one entry.");
  if (entries.length > 0xffff) throw new Error("Too many entries for a zip.");
  const { date, time } = dosDateTime(when);
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const raw = Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    const deflated = deflateRawSync(raw, { level: 9 });
    const stored = deflated.length >= raw.length;
    const body = stored ? raw : deflated;
    const crc = crc32(raw);
    if (raw.length > 0xffffffff || offset > 0xffffffff) throw new Error("The bundle is too large for a zip without zip64.");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: names are UTF-8
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4); // made by (2.0, MS-DOS)
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(stored ? 0 : 8, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(name.length, 28);
    // extra, comment, disk, internal and external attributes: all 0
    header.writeUInt32LE(offset, 42);

    parts.push(local, name, body);
    central.push(header, name);
    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** site.json, then site.db, then content/ by name: the same inputs make the same zip entry order. */
export function packBundle(options: PackOptions): PackedBundle {
  if (!options.contentDir && !options.dataFile) throw new Error("A bundle has to hold the content, the database or both.");
  const builtAt = options.builtAt ?? new Date();
  const content = options.contentDir ? readContentFiles(options.contentDir) : [];
  const data = options.dataFile ? readPublicCopy(options.dataFile) : null;

  const includes: BundlePart[] = [];
  if (options.contentDir) includes.push("content");
  if (data) includes.push("data");
  const manifest = createManifest({
    slug: options.slug,
    name: options.name,
    type: options.type ?? (data ? "dynamic" : "static"),
    register: options.register ?? false,
    includes,
    builtAt,
  });

  const entries: ZipEntry[] = [{ path: "site.json", data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8") }];
  if (data) entries.push({ path: "site.db", data });
  entries.push(...content);

  if (entries.length > MAX_BUNDLE_ENTRIES) {
    throw new Error(`The bundle would have ${entries.length} files; the server accepts at most ${MAX_BUNDLE_ENTRIES}.`);
  }
  const total = entries.reduce((sum, entry) => sum + entry.data.byteLength, 0);
  if (total > MAX_BUNDLE_BYTES) {
    throw new Error(`The bundle would unpack to ${(total / 1048576).toFixed(0)} MB; the server accepts at most ${MAX_BUNDLE_BYTES / 1048576} MB.`);
  }

  const zip = createZip(entries, builtAt);
  return { zip, manifest, sha256: sha256Hex(zip), contentFiles: content.length };
}

/** egov-20261013-153000.zip, in this machine's local time (what the person sending it sees on their clock). */
export function bundleFileName(slug: string, when: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const day = `${when.getFullYear()}${two(when.getMonth() + 1)}${two(when.getDate())}`;
  const clock = `${two(when.getHours())}${two(when.getMinutes())}${two(when.getSeconds())}`;
  return `${slug}-${day}-${clock}.zip`;
}
