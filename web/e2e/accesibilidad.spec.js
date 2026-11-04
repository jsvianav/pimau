// Accesibilidad automática (RNF-07, WCAG 2.2 AA): axe-core sobre cada vista,
// en escritorio y celular, en modo claro y oscuro, y en los casos extremos.
// Cada prueba adjunta una captura de la vista al informe.
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { abrirVisor, elegirEstacion, instalarApi, irA } from "./api-simulada.js";

const REGLAS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

const PANTALLAS = {
  escritorio: { viewport: { width: 1280, height: 800 } },
  celular: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
};

const VISTAS = [
  { nombre: "mapa", pasos: async () => {} },
  { nombre: "mapa con ficha", pasos: (page) => elegirEstacion(page, "Universidad Libre") },
  { nombre: "estación con dos fuentes", pasos: (page) => elegirEstacion(page, "Base Aérea") },
  { nombre: "histórico", pasos: async (page) => {
    await irA(page, "Histórico");
    await page.locator(".lienzo").waitFor();
  } },
  { nombre: "inicio de sesión", pasos: (page) => irA(page, "Administración") },
  { nombre: "panel de administración", sesion: true, pasos: async (page) => {
    await irA(page, "Administración");
    await page.locator(".tabla-fuentes").first().waitFor();
  } },
];

async function revisar(page, testInfo) {
  const { violations } = await new AxeBuilder({ page }).withTags(REGLAS).analyze();
  await testInfo.attach("captura", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  // El resumen dice qué regla falla y en qué elementos, para corregir sin abrir el informe.
  const resumen = violations.map((v) => `${v.impact} · ${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
  expect(resumen).toEqual([]);
}

for (const [pantalla, opciones] of Object.entries(PANTALLAS)) {
  for (const esquema of ["light", "dark"]) {
    test.describe(`${pantalla}, modo ${esquema === "light" ? "claro" : "oscuro"}`, () => {
      test.use({ ...opciones, colorScheme: esquema });
      for (const vista of VISTAS) {
        test(`${vista.nombre}: sin violaciones de axe`, async ({ page }, testInfo) => {
          await instalarApi(page, { sesion: vista.sesion });
          await abrirVisor(page);
          await vista.pasos(page);
          await revisar(page, testInfo);
        });
      }
    });
  }
}

test.describe("casos extremos", () => {
  test.use(PANTALLAS.celular);

  test("peor caso con la ficha en el tope del ICA", async ({ page }, testInfo) => {
    await instalarApi(page, { caso: "peor" });
    await abrirVisor(page);
    await elegirEstacion(page, "Institución Educativa");
    await revisar(page, testInfo);
  });

  test("sin estaciones", async ({ page }, testInfo) => {
    await instalarApi(page, { caso: "vacio" });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "No hay estaciones para mostrar" })).toBeVisible();
    await page.locator(".controles-mapa").waitFor();
    await revisar(page, testInfo);
  });

  test("error de la API", async ({ page }, testInfo) => {
    await instalarApi(page, { caso: "error" });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
    await page.locator(".controles-mapa").waitFor();
    await revisar(page, testInfo);
  });
});
