// Loaded by every page (Layout.astro). The kiosk only puts ?citizenId= on the
// page it opens, and every link on this site is a full navigation, so reading
// it here -- which stashes it in sessionStorage (see lib/citizen.ts) -- is what
// lets the scan step on a later page, or on the home page after a detour,
// still know who is using the kiosk.

import { getCurrentCitizenId } from "../lib/citizen.ts";
import { isKiosk } from "../lib/kiosk.ts";

if (isKiosk) getCurrentCitizenId();
