/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base da API exclusiva do Dashboard 2.0 (dashboard-v2/api/server.ts, porta 5184 por padrão). Sem fallback — se ausente, o app mostra estado de erro em vez de tentar a porta 8787. */
  readonly VITE_DASHBOARD_V2_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
