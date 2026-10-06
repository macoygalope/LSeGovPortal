// @ts-check
import { defineConfig } from "astro/config";

// Two build targets, same pattern as prestige-lspd-website:
//   npm run build        -> served from a domain root
//   npm run build:kiosk  -> served by lspd-backend at /api/v1/websites/egov
//                           on an in-game kiosk screen; no external links
//                           (see src/lib/kiosk.ts)
// `base` can't be hardcoded to the kiosk subpath without breaking the normal
// build, so KIOSK_BUILD switches it for that one target only.
const kioskBuild = process.env.KIOSK_BUILD === "1";
const kioskBase = "/api/v1/websites/egov";

export default defineConfig({
  // scripts/build.mjs builds into a staging folder and swaps it into dist/
  // only on success, so a failed data load can't wipe the last good build.
  outDir: process.env.EGOV_OUT_DIR || "./dist",

  base: kioskBuild ? kioskBase : "/",

  // lspd-backend's ServeAsset route only serves from a site's assets/ folder
  // (see lspd-backend/websites/README.md), so Astro's default "_astro" has to
  // be renamed.
  build: {
    assets: "assets",
  },

  // Remote images (r2.fivemanage.com) are downloaded and optimized at build
  // time so the kiosk never depends on a third-party host at runtime.
  image: {
    domains: ["r2.fivemanage.com"],
  },

  vite: {
    // Exposes the build target to components as import.meta.env.KIOSK
    // (see src/lib/kiosk.ts).
    define: {
      "import.meta.env.KIOSK": JSON.stringify(kioskBuild),
    },
  },
});
