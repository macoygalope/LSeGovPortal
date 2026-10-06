/**
 * True only in `npm run build:kiosk` -- the build served on in-game kiosk
 * screens by lspd-backend. Defined at build time in astro.config.mjs.
 *
 * On a kiosk the screen browser can't be assumed to open external sites, so
 * links to Google Forms, the booking calendar and signed copies are replaced
 * with placeholders until built-in forms exist (see ExternalAction.astro).
 */
export const isKiosk: boolean = import.meta.env.KIOSK === true;
