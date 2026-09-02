import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// VITE_API_BASE_URL is read at runtime via import.meta.env; no hardcoding.
// Dev proxy not needed (frontend talks to Fastify on :3000), but keep CORS open.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
})
