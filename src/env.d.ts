/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Set by astro.config.mjs; true only for the kiosk build. */
  readonly KIOSK: boolean;
  /** lspd-backend's origin, for the citizen lookup (see src/lib/citizen.ts). Unset on the kiosk build: the page asks the host it came from. */
  readonly PUBLIC_LSPD_API_URL?: string;
  /** Where a build served from somewhere else reads the content live: lspd-backend's site, e.g. https://gov-api.example/api/v1/websites/egov (see src/scripts/egov-page.ts). */
  readonly PUBLIC_EGOV_DATA_URL?: string;
  /** Development only: the citizen to pretend is using the site (see src/lib/citizen.ts). */
  readonly PUBLIC_MOCK_CITIZEN_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
