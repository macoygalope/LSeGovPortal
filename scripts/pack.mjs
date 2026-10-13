// Makes a site bundle: ONE .zip holding the kiosk build, the public copy of the database
// and a site.json that says what it is. It is the only file a server needs.
//
//   npm run site:pack                       build both, write bundles/egov-<date>-<time>.zip
//   npm run site:pack -- --only data        just the database (the pages are not rebuilt)
//   npm run site:pack -- --only content     just the pages
//   npm run site:pack -- --register         the site's first deploy: also register it in lspd-backend's catalog
//   npm run site:pack -- --no-build         use the dist/ already built, rather than building it again
//   npm run site:pack -- --db <file>        another source database (default $EGOV_DB_FILE, then data/egov.db)
//
// What to do with it (over SSH, or by hand) is printed at the end and written up in the README.
// `npm run deploy` runs this first, so most days you only run that.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { DEFAULT_DB_FILE } from "../src/lib/data.ts";
import { buildPublicDatabase } from "../src/lib/public-db.ts";
import { bundleFileName, packBundle } from "../src/lib/site-bundle.ts";

/** The site this portal is: what the bundle says it is, and so what the server deploys it as. */
export const SITE_SLUG = "egov";
export const SITE_NAME = "Los Santos eGov";

const root = resolve(import.meta.dirname, "..");

/**
 * Builds what is asked for, packs it and writes bundles/<slug>-<date>-<time>.zip.
 * @param {{ only?: "content" | "data", register?: boolean, db?: string, noBuild?: boolean, log?: (line: string) => void }} options
 */
export function packSite(options = {}) {
  const log = options.log ?? console.log;
  const only = options.only;
  if (only && only !== "content" && only !== "data") throw new Error("--only is 'content' or 'data'.");

  let contentDir;
  if (only !== "data") {
    contentDir = join(root, "dist");
    if (options.noBuild) {
      if (!existsSync(contentDir)) throw new Error("There is no dist/ to use. Run without --no-build, or: npm run build:kiosk");
      log(`Using the dist/ already built (${statSync(contentDir).mtime.toLocaleString()}).`);
    } else {
      log("Building the kiosk site...");
      const build = spawnSync(process.execPath, [join(root, "scripts", "build.mjs"), "--kiosk"], { cwd: root, stdio: "inherit" });
      if (build.status !== 0) throw new Error("The build failed, so nothing was packed.");
    }
  }

  let dataFile;
  let work;
  try {
    if (only !== "content") {
      const source = options.db || process.env.EGOV_DB_FILE || DEFAULT_DB_FILE;
      work = mkdtempSync(join(tmpdir(), "egov-pack-"));
      dataFile = join(work, "site.db");
      const built = buildPublicDatabase(source, dataFile);
      log(`Built the public database from ${source} (${(built.bytes / 1024).toFixed(0)} KB, ${Object.values(built.records).reduce((a, b) => a + b, 0)} records).`);
    }

    const builtAt = new Date();
    const packed = packBundle({ slug: SITE_SLUG, name: SITE_NAME, type: "dynamic", register: Boolean(options.register), contentDir, dataFile, builtAt });
    const outDir = join(root, "bundles");
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, bundleFileName(SITE_SLUG, builtAt));
    writeFileSync(file, packed.zip);
    return { file, packed };
  } finally {
    if (work) rmSync(work, { recursive: true, force: true });
  }
}

/** What the person who made a bundle needs to know next, whichever way it goes to the server. */
export function describeBundle(file, packed) {
  const shown = relative(process.cwd(), file) || file;
  const parts = [];
  if (packed.manifest.includes.includes("content")) parts.push(`pages and assets (${packed.contentFiles} files)`);
  if (packed.manifest.includes.includes("data")) parts.push("database");
  return [
    `Bundle ready: ${shown}  (${(packed.zip.length / 1048576).toFixed(1)} MB)`,
    `  holds   ${parts.join(" + ")}${packed.manifest.register ? "   (will also register the site)" : ""}`,
    `  sha256  ${packed.sha256}`,
    "",
    "Put it on a server:",
    `  yourself, over SSH      npm run deploy -- staging --zip ${shown.replaceAll("\\", "/")}`,
    "  by hand, no SSH         send that one file to whoever runs the server. On the server they drag it",
    "                          onto deploy-site-staging.cmd (or deploy-site-production.cmd), which are",
    "                          in prestige-nginx\\deploy\\windows. To confirm it arrived intact they can run",
    `                          certutil -hashfile <the file> SHA256   and compare with the sha256 above.`,
  ].join("\n");
}

function main() {
  const { values } = parseArgs({
    options: { only: { type: "string" }, register: { type: "boolean" }, db: { type: "string" }, "no-build": { type: "boolean" } },
  });
  try {
    const { file, packed } = packSite({ only: values.only, register: values.register, db: values.db, noBuild: values["no-build"] });
    console.log("\n" + describeBundle(file, packed));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
