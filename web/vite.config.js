import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En desarrollo, las llamadas a /api van a la API local (docker compose up api).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8000" } },
  build: {
    rollupOptions: {
      // Las librerías grandes van en archivos aparte para que el navegador las guarde en caché.
      output: { manualChunks: { mapa: ["maplibre-gl"], graficas: ["recharts"] } },
    },
    chunkSizeWarningLimit: 900,
  },
});
