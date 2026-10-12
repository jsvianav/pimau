import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En desarrollo, las llamadas a /api van a la API local (docker compose up api).
export default defineConfig({
  plugins: [react()],
  // El proceso en segundo plano de MapLibre es un módulo ES.
  worker: { format: "es" },
  server: { proxy: { "/api": "http://localhost:8000" } },
  build: {
    rollupOptions: {
      // Las librerías grandes van en archivos aparte para que el navegador las guarde en caché.
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/maplibre-gl")) return "mapa";
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) return "graficas";
        },
      },
    },
    // MapLibre 6 ocupa cerca de 1 MB sin comprimir y va en su propio archivo.
    chunkSizeWarningLimit: 1100,
  },
});
