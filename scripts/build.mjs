// Builds into a staging folder and only replaces dist/ if the build succeeds.
//
// `astro build` empties its output folder before it fetches the eGov data, so
// a failed fetch (backend down, bad URL) would otherwise leave dist/ half
// written -- and dist/ is what gets copied onto the server. With staging, a
// failed build exits non-zero and the previous good dist/ is untouched.
//
//   node scripts/build.mjs            normal build (domain root, includes /admin)
//   node scripts/build.mjs --kiosk    kiosk build (served by lspd-backend)

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const kiosk = process.argv.includes("--kiosk");
const root = resolve(import.meta.dirname, "..");
const staging = join(root, ".build");
const dist = join(root, "dist");

// Run Astro's own CLI entry point with this same Node, rather than going
// through npx/.cmd shims, which behave differently on Windows.
const astroPackageJson = createRequire(import.meta.url).resolve("astro/package.json");
const astroBin = join(dirname(astroPackageJson), JSON.parse(readFileSync(astroPackageJson, "utf8")).bin.astro);

rmSync(staging, { recursive: true, force: true });

const result = spawnSync(process.execPath, [astroBin, "build"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    EGOV_OUT_DIR: staging,
    ...(kiosk ? { KIOSK_BUILD: "1" } : { KIOSK_BUILD: "" }),
  },
});

if (result.status !== 0 || !existsSync(join(staging, "index.html"))) {
  rmSync(staging, { recursive: true, force: true });
  console.error("\nBuild failed -- dist/ was left untouched.");
  process.exit(result.status || 1);
}

rmSync(dist, { recursive: true, force: true });
renameSync(staging, dist);
console.log(`\nBuilt ${kiosk ? "kiosk" : "web"} site into ${dist}`);
