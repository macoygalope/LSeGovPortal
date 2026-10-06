/**
 * Prefixes a root-relative path ("/announcements/", "/#forms") with the
 * configured `base`, so internal links keep working when the site is served
 * from a subpath -- e.g. lspd-backend's kiosk hosting at
 * /api/v1/websites/egov (see astro.config.mjs). Astro only auto-prefixes
 * URLs that go through its own asset pipeline, not hrefs written in markup.
 */
export function withBase(path: string, base: string = import.meta.env.BASE_URL): string {
  const prefix = base.replace(/\/$/, "");
  if (path === "/") return prefix || "/";
  return `${prefix}${path}`;
}
