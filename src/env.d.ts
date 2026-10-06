/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Set by astro.config.mjs; true only for the kiosk build. */
  readonly KIOSK: boolean;
  /** lspd-backend's origin, for the citizen lookup (see src/lib/citizen.ts). */
  readonly PUBLIC_LSPD_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
