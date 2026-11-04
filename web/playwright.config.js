import { defineConfig, devices } from "@playwright/test";

// Pruebas de extremo a extremo del visor: corren contra el build de producción
// (vite preview) con la API simulada de e2e/api-simulada.js, así que no
// necesitan el backend ni el mapa base de OpenFreeMap. `npm run e2e` construye
// y prueba.
export default defineConfig({
  testDir: "e2e",
  timeout: 30000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // En CI el informe HTML guarda las capturas de cada vista para revisarlas a ojo.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    locale: "es-CO",
    timezoneId: "America/Bogota",
    trace: "retain-on-failure",
    // WebGL sin GPU, para que MapLibre dibuje las estaciones.
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx vite preview --port 4173 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
