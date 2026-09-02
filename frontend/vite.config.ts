import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// VITE_API_BASE_URL is read at runtime via import.meta.env; no hardcoding.
// In dev, use vite proxy so browser fetch to relative URL is forwarded to Fastify
// inside the Codespace (avoids localhost:3000 not being reachable from browser).
// In prod, set VITE_API_BASE_URL to deployed API URL; fallback to relative (proxy) in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/health": { target: "http://localhost:3000", changeOrigin: true },
      "/markets": { target: "http://localhost:3000", changeOrigin: true },
      "/strategies": { target: "http://localhost:3000", changeOrigin: true },
      "/positions": { target: "http://localhost:3000", changeOrigin: true },
      "/orders": { target: "http://localhost:3000", changeOrigin: true },
      "/portfolio": { target: "http://localhost:3000", changeOrigin: true },
      "/bots": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
})
