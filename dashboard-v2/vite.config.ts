import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dashboard 2.0 roda numa porta PRÓPRIA (5183). A partir da migração
// "Isolamento Real" o frontend fala DIRETO com a API exclusiva do
// Dashboard 2.0 (dashboard-v2/api/server.ts, porta 5184 via
// VITE_DASHBOARD_V2_API_URL, ver .env) — sem proxy, sem passar pelo
// servidor antigo (8787) em nenhuma hipótese. A API V2 envia os headers
// CORS necessários pra essa chamada cross-origin funcionar sem proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5183,
  },
})
