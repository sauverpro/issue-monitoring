/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  /** Optional origin for the live SSE stream when the frontend host cannot proxy long-lived responses. */
  readonly VITE_STREAM_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
