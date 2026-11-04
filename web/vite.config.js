import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// En desarrollo, las llamadas a /api van a la API local (docker compose up api).
export default defineConfig({
  plugins: [react()],
  // El proceso en segundo plano de MapLibre es un módulo ES.
  worker: { format: "es" },
  server: { proxy: { "/api": "http://localhost:8000" } },
  build: {
    rolldownOptions: {
      output: {
        // Las librerías grandes van en archivos aparte para que el navegador las
        // guarde en caché. Cada grupo se lleva también las dependencias de sus
        // módulos; por eso React va primero (mayor prioridad): si no, el grupo de
        // las gráficas se lo llevaba por ser dependencia de Recharts, y la página
        // tenía que descargar las gráficas al abrir aunque no las mostrara.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 3 },
            { name: "mapa", test: /node_modules[\\/]maplibre-gl[\\/]/, priority: 2 },
            { name: "graficas", test: /node_modules[\\/](recharts|victory-vendor|d3-[a-z-]+)[\\/]/, priority: 1 },
          ],
        },
      },
    },
    // MapLibre 6 ocupa cerca de 1 MB sin comprimir y va en su propio archivo.
    chunkSizeWarningLimit: 1100,
  },
  // Las pruebas de extremo a extremo (e2e/) corren con Playwright, no con Vitest.
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
});
