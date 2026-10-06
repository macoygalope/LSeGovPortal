/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_EGOV_API_URL: string;
  /** Set by astro.config.mjs; true only for the kiosk build. */
  readonly KIOSK: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
