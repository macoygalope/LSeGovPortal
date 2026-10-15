import type { APIRoute } from "astro";

import { serializeSnapshot } from "../../lib/site-source";
import { getSnapshot } from "../../lib/snapshot";

// The copy of the content this build keeps for the pages to fall back on when
// lspd-backend does not answer (lib/site-source.ts, loadSiteData). Published
// records only: normalising has already dropped every draft. It is under
// assets/ because that is the one folder lspd-backend serves files from beside
// the pages.
export const GET: APIRoute = async () =>
  new Response(serializeSnapshot(await getSnapshot()), { headers: { "Content-Type": "application/json" } });
