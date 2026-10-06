import type { AstroIntegration } from "astro";

import { ADMIN_API_PATH, createAdminApi, type AdminApiOptions } from "./admin-api.ts";

/**
 * Adds the admin dashboard to an Astro dev server: the `/admin` page and the
 * API it talks to (admin-api.ts). Only scripts/admin.mjs passes this in, so
 * neither exists in astro.config.mjs, a build, or `npm run dev`: the page
 * writes to the database, and a static site has nowhere to run that.
 *
 * The dev server serves the site too, so "view the website" shows what was just
 * saved: in dev, data.ts reads the database again on every page.
 */
export function adminIntegration(options: AdminApiOptions): AstroIntegration {
  return {
    name: "egov-admin",
    hooks: {
      "astro:config:setup": ({ injectRoute }) => {
        injectRoute({ pattern: "/admin", entrypoint: "./src/admin/admin.astro" });
      },
      "astro:server:setup": ({ server }) => {
        server.middlewares.use(ADMIN_API_PATH, createAdminApi(options));
      },
    },
  };
}
