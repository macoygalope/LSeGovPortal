import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { crc32, inflateRawSync } from "node:zlib";

import {
  BUNDLE_FORMAT,
  MAX_BUNDLE_ENTRIES,
  bundleFileName,
  createManifest,
  createZip,
  isDatabaseFileName,
  isUnsafeSegment,
  packBundle,
  readContentFiles,
  readPublicCopy,
  sha256Hex,
} from "./site-bundle.ts";
import { PUBLIC_COPY_APPLICATION_ID } from "./public-db.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "site-bundle-test-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A built site: index.html, an asset and a nested page. */
function writeSite(dir: string, extra: Record<string, string> = {}) {
  const files: Record<string, string> = {
    "index.html": "<html>home</html>",
    "assets/app.css": "body{}",
    "page/index.html": "<html>page</html>",
    ...extra,
  };
  for (const [path, text] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  }
}

/** What `npm run site:build` makes, as far as the header goes: SQLite's, with the public copy's application id. */
function writePublicCopy(file: string, id = PUBLIC_COPY_APPLICATION_ID, mark = "v1") {
  const bytes = Buffer.alloc(4096);
  bytes.write("SQLite format 3", 0, "latin1");
  bytes.writeUInt32BE(id, 68);
  bytes.write(mark, 200, "latin1");
  writeFileSync(file, bytes);
}

interface ReadEntry {
  name: string;
  data: Buffer;
  method: number;
  flags: number;
}

/**
 * An independent zip reader: finds the end record, walks the central directory, and checks each
 * entry's header, sizes and CRC against its data. If createZip got any of that wrong, this says so.
 */
function readZip(zip: Buffer): ReadEntry[] {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, "no end-of-central-directory record");
  const count = zip.readUInt16LE(end + 10);
  assert.equal(zip.readUInt16LE(end + 8), count);
  const size = zip.readUInt32LE(end + 12);
  const offset = zip.readUInt32LE(end + 16);
  assert.equal(offset + size, end, "the directory ends where the end record begins");

  const out: ReadEntry[] = [];
  let at = offset;
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50, "central directory header signature");
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressed = zip.readUInt32LE(at + 20);
    const uncompressed = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);

    assert.equal(zip.readUInt32LE(local), 0x04034b50, "local header signature");
    assert.equal(zip.readUInt16LE(local + 26), nameLength);
    assert.equal(zip.toString("utf8", local + 30, local + 30 + nameLength), name, "local and central names agree");
    assert.equal(zip.readUInt32LE(local + 14), crc, "local and central CRCs agree");
    const start = local + 30 + nameLength + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(data.length, uncompressed, `size of ${name}`);
    assert.equal(crc32(data), crc, `CRC of ${name}`);
    out.push({ name, data, method, flags });
    at += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(at, end);
  return out;
}

describe("createZip", () => {
  it("round-trips text, an empty file, binary data and a unicode name", () => {
    const binary = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7919 + (i >> 3)) & 255));
    const entries = [
      { path: "a.txt", data: Buffer.from("hello hello hello hello hello hello") },
      { path: "empty", data: Buffer.alloc(0) },
      { path: "dir/bin.dat", data: binary },
      { path: "content/café/日本.html", data: Buffer.from("<p>unicode</p>") },
    ];
    const read = readZip(createZip(entries));
    assert.deepEqual(read.map((e) => e.name), entries.map((e) => e.path));
    for (let i = 0; i < entries.length; i++) assert.deepEqual(read[i].data, Buffer.from(entries[i].data));
  });

  it("deflates what shrinks and stores what does not (an empty file, noise)", () => {
    const noise = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 255));
    const read = readZip(
      createZip([
        { path: "big.txt", data: Buffer.from("x".repeat(10000)) },
        { path: "empty", data: Buffer.alloc(0) },
        { path: "noise", data: noise },
      ]),
    );
    assert.equal(read[0].method, 8);
    assert.equal(read[1].method, 0);
    assert.equal(read[2].method, 0);
  });

  it("flags names as UTF-8", () => {
    assert.equal(readZip(createZip([{ path: "a", data: Buffer.from("x") }]))[0].flags & 0x0800, 0x0800);
  });

  it("makes the same bytes for the same entries and time", () => {
    const entries = [{ path: "a", data: Buffer.from("same") }, { path: "b/c", data: Buffer.from("same too") }];
    const when = new Date(2026, 9, 13, 15, 30, 0);
    assert.deepEqual(createZip(entries, when), createZip(entries, when));
  });

  it("refuses to make an empty zip", () => {
    assert.throws(() => createZip([]), /at least one/);
  });
});

describe("names", () => {
  it("knows what Windows cannot unpack", () => {
    for (const bad of ["", ".", "..", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b", "a\u0007b", "trailing.", "trailing "]) {
      assert.equal(isUnsafeSegment(bad), true, JSON.stringify(bad));
    }
    for (const good of ["index.html", "app.css", ".htaccess", "café", "a-b_c.d", "file name.txt"]) {
      assert.equal(isUnsafeSegment(good), false, good);
    }
  });

  it("knows a database from a page, sidecars included", () => {
    for (const db of ["site.db", "a.SQLITE", "x.sqlite3", "site.db-wal", "site.db-shm", "site.db-journal", "SITE.DB-WAL"]) {
      assert.equal(isDatabaseFileName(db), true, db);
    }
    for (const page of ["index.html", "database.html", "db", "notes.dbx", "a.db.html", "wal"]) {
      assert.equal(isDatabaseFileName(page), false, page);
    }
  });
});

describe("createManifest", () => {
  const base = { slug: "egov", name: "Los Santos eGov", type: "dynamic" as const, register: false, includes: ["data", "content"] as ("content" | "data")[], builtAt: new Date("2026-10-13T07:30:00Z") };

  it("describes the bundle, with includes sorted and the time in ISO", () => {
    assert.deepEqual(createManifest(base), {
      format: BUNDLE_FORMAT,
      slug: "egov",
      name: "Los Santos eGov",
      type: "dynamic",
      register: false,
      includes: ["content", "data"],
      builtAt: "2026-10-13T07:30:00.000Z",
    });
  });

  it("refuses a slug, a name or an empty bundle the server would", () => {
    for (const slug of ["Egov", "../x", "a/b", "-x", "x-", "a b", ""]) {
      assert.throws(() => createManifest({ ...base, slug }), /not a valid site slug/, slug);
    }
    assert.throws(() => createManifest({ ...base, name: "" }), /site name/);
    assert.throws(() => createManifest({ ...base, name: "x".repeat(101) }), /site name/);
    assert.throws(() => createManifest({ ...base, name: "a\u0007b" }), /site name/);
    assert.throws(() => createManifest({ ...base, includes: [] }), /content, the database or both/);
  });
});

describe("readContentFiles", () => {
  it("returns every file under content/, sorted, with forward slashes", () => {
    const dir = tempDir();
    writeSite(dir);
    const files = readContentFiles(dir);
    assert.deepEqual(files.map((f) => f.path), ["content/assets/app.css", "content/index.html", "content/page/index.html"]);
    assert.equal(files[1].data.toString(), "<html>home</html>");
  });

  it("refuses what the server would", () => {
    const missing = join(tempDir(), "nope");
    assert.throws(() => readContentFiles(missing), /does not exist.*build:kiosk/);

    const file = join(tempDir(), "f.txt");
    writeFileSync(file, "x");
    assert.throws(() => readContentFiles(file), /not a folder/);

    const noIndex = tempDir();
    writeSite(noIndex);
    rmSync(join(noIndex, "index.html"));
    assert.throws(() => readContentFiles(noIndex), /no index\.html/);

    for (const storage of ["storage", "Storage"]) {
      const dir = tempDir();
      writeSite(dir, { [`${storage}/upload.png`]: "x" });
      assert.throws(() => readContentFiles(dir), /'storage' folder/, storage);
    }
    // ... but a nested one is only a folder with that name.
    const nested = tempDir();
    writeSite(nested, { "assets/storage/ok.txt": "x" });
    assert.equal(readContentFiles(nested).length, 4);

    for (const name of ["assets/leak.db", "assets/leak.sqlite", "assets/leak.db-wal"]) {
      const dir = tempDir();
      writeSite(dir, { [name]: "x" });
      assert.throws(() => readContentFiles(dir), /is a database file/, name);
    }
  });

  it("refuses a link (when this machine lets a test make one)", (t) => {
    const dir = tempDir();
    writeSite(dir);
    try {
      symlinkSync(join(dir, "index.html"), join(dir, "link.html"));
    } catch {
      t.skip("symlinks need a privilege here");
      return;
    }
    assert.throws(() => readContentFiles(dir), /is a link/);
  });
});

describe("readPublicCopy", () => {
  it("returns the bytes of a public copy", () => {
    const dir = tempDir();
    const file = join(dir, "site.db");
    writePublicCopy(file);
    assert.equal(readPublicCopy(file).length, 4096);
  });

  it("refuses the database that is edited, anything not SQLite, and a missing file", () => {
    const dir = tempDir();
    const authoring = join(dir, "authoring.db");
    writePublicCopy(authoring, 0);
    assert.throws(() => readPublicCopy(authoring), /not a public copy made by 'npm run site:build'/);

    const text = join(dir, "notes.db");
    writeFileSync(text, "this is not a database");
    assert.throws(() => readPublicCopy(text), /not a SQLite database/);

    const empty = join(dir, "empty.db");
    writeFileSync(empty, "");
    assert.throws(() => readPublicCopy(empty), /not a SQLite database/);

    assert.throws(() => readPublicCopy(join(dir, "missing.db")), /does not exist.*site:build/);
  });
});

describe("packBundle", () => {
  const when = new Date(2026, 9, 13, 15, 30, 0);

  function setup() {
    const dir = tempDir();
    const dist = join(dir, "dist");
    mkdirSync(dist);
    writeSite(dist);
    const db = join(dir, "site.db");
    writePublicCopy(db, PUBLIC_COPY_APPLICATION_ID, "pack");
    return { dir, dist, db };
  }

  it("packs content and database: site.json first, then site.db, then content/", () => {
    const { dist, db } = setup();
    const packed = packBundle({ slug: "egov", name: "Los Santos eGov", contentDir: dist, dataFile: db, builtAt: when });
    const read = readZip(packed.zip);
    assert.deepEqual(read.map((e) => e.name), ["site.json", "site.db", "content/assets/app.css", "content/index.html", "content/page/index.html"]);
    assert.deepEqual(JSON.parse(read[0].data.toString()), packed.manifest);
    assert.deepEqual(packed.manifest.includes, ["content", "data"]);
    assert.equal(packed.manifest.type, "dynamic");
    assert.equal(packed.manifest.register, false);
    assert.equal(packed.contentFiles, 3);
    assert.equal(read[1].data.length, 4096);
    assert.equal(packed.sha256, sha256Hex(packed.zip));
    assert.match(packed.sha256, /^[0-9a-f]{64}$/);
  });

  it("packs only what it is given", () => {
    const { dist, db } = setup();
    const dataOnly = packBundle({ slug: "egov", name: "x", dataFile: db, builtAt: when });
    assert.deepEqual(readZip(dataOnly.zip).map((e) => e.name), ["site.json", "site.db"]);
    assert.deepEqual(dataOnly.manifest.includes, ["data"]);
    const contentOnly = packBundle({ slug: "egov", name: "x", contentDir: dist, builtAt: when });
    assert.deepEqual(readZip(contentOnly.zip).map((e) => e.name)[0], "site.json");
    assert.deepEqual(contentOnly.manifest.includes, ["content"]);
    assert.equal(contentOnly.manifest.type, "static");
  });

  it("carries the register request and an explicit type", () => {
    const { dist, db } = setup();
    const packed = packBundle({ slug: "egov", name: "x", type: "static", register: true, contentDir: dist, dataFile: db, builtAt: when });
    assert.equal(packed.manifest.register, true);
    assert.equal(packed.manifest.type, "static");
  });

  it("is the same bytes for the same input", () => {
    const { dist, db } = setup();
    const a = packBundle({ slug: "egov", name: "x", contentDir: dist, dataFile: db, builtAt: when });
    const b = packBundle({ slug: "egov", name: "x", contentDir: dist, dataFile: db, builtAt: when });
    assert.equal(a.sha256, b.sha256);
  });

  it("refuses nothing to pack, and the same mistakes the server would", () => {
    const { dir, dist, db } = setup();
    assert.throws(() => packBundle({ slug: "egov", name: "x" }), /content, the database or both/);
    assert.throws(() => packBundle({ slug: "Egov", name: "x", contentDir: dist }), /not a valid site slug/);
    const authoring = join(dir, "authoring.db");
    writePublicCopy(authoring, 0);
    assert.throws(() => packBundle({ slug: "egov", name: "x", dataFile: authoring }), /not a public copy/);
    writeSite(dist, { "leak.db": "x" });
    assert.throws(() => packBundle({ slug: "egov", name: "x", contentDir: dist, dataFile: db }), /is a database file/);
  });

  it("refuses a site with more files than the server accepts", () => {
    const { dist, db } = setup();
    mkdirSync(join(dist, "many"));
    for (let i = 0; i < MAX_BUNDLE_ENTRIES; i++) writeFileSync(join(dist, "many", `f${i}.txt`), "x");
    assert.throws(() => packBundle({ slug: "egov", name: "x", contentDir: dist, dataFile: db }), /at most 5000/);
  });
});

describe("bundleFileName", () => {
  it("is the slug and the local date and time", () => {
    assert.equal(bundleFileName("egov", new Date(2026, 9, 13, 15, 30, 5)), "egov-20261013-153005.zip");
    assert.equal(bundleFileName("egov", new Date(2026, 0, 2, 3, 4, 5)), "egov-20260102-030405.zip");
  });
});
