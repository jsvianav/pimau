// Histórico: estaciones según la variable, atajos de periodo y comparación de
// dos series (fase 5 del plan de mejora).
import { expect, test } from "@playwright/test";
import { abrirVisor, instalarApi, irA } from "./api-simulada.js";

test.use({ viewport: { width: 1280, height: 900 } });

async function abrirHistorico(page) {
  await instalarApi(page);
  await abrirVisor(page);
  await irA(page, "Histórico");
  await page.locator(".lienzo").waitFor();
}

test("solo se ofrecen las estaciones que miden la variable", async ({ page }) => {
  await abrirHistorico(page);
  await page.getByLabel("Variable").selectOption("HUM");
  const estaciones = page.getByLabel("Estación y fuente");
  await expect(estaciones.locator("option")).toHaveText(["Universidad de San Buenaventura (SATIC (red OAC22))"]);
  await expect(page.locator(".lienzo h3")).toHaveText("Humedad en Universidad de San Buenaventura (SATIC (red OAC22))");
});

test("los atajos consultan un periodo que termina en el último dato", async ({ page }) => {
  await abrirHistorico(page);
  await expect(page.locator(".filtros .nota-rango")).toContainText("Hay datos del");
  const siete = page.getByRole("button", { name: "7 días" });
  await siete.click();
  await expect(siete).toHaveAttribute("aria-pressed", "true");
  const desde = await page.getByLabel("Desde").inputValue();
  const hasta = await page.getByLabel("Hasta").inputValue();
  expect((Date.parse(hasta) - Date.parse(desde)) / 86400000).toBe(7);
  // Con años de datos (IDEAM, 2020 a 2025), «Todo» pasa a promedios diarios.
  await page.getByLabel("Estación y fuente").selectOption({ label: "Pance (IDEAM (datos.gov.co))" });
  await page.locator(".lienzo").waitFor();
  await page.getByRole("button", { name: "Todo" }).click();
  await expect(page.locator(".unidad-eje")).toContainText("promedios diarios");
  await expect(page.getByLabel("Desde")).toHaveValue("2020-01-01");
});

test("comparar dos series: leyenda, cifras, tabla y descarga de cada una", async ({ page }) => {
  await abrirHistorico(page);
  await page.getByLabel("Comparar con").selectOption({ label: "San Martín (SATIC (red OAC22))" });
  await expect(page.locator(".referencias")).toContainText("San Martín (SATIC (red OAC22))");
  await expect(page.locator(".cifras")).toContainText("Promedio de la comparación");
  await expect(page.getByRole("link", { name: "Descargar la comparación en CSV" })).toHaveAttribute("href", /estaciones\/10\/series\.csv/);
  await page.getByRole("button", { name: "Ver los datos como tabla" }).click();
  await expect(page.locator(".tabla-datos thead th")).toContainText(["Fecha y hora", "Valor (µg/m³)", "San Martín (SATIC (red OAC22)) (µg/m³)"]);
});

test("el ciclo del día dice a qué hora suele estar más alto y tiene su tabla", async ({ page }) => {
  await abrirHistorico(page);
  const ciclo = page.locator(".ciclo");
  await expect(ciclo.getByRole("heading", { name: "Ciclo del día" })).toBeVisible();
  await expect(ciclo.locator(".resumen")).toContainText(/suelen ser más altos hacia las \d{2}:00/);
  await ciclo.getByText("Ver el ciclo como tabla").click();
  await expect(ciclo.locator("tbody tr")).toHaveCount(24);
  // Con promedios diarios no hay horas que promediar: lo dice en vez de dibujar.
  await page.getByLabel("Estación y fuente").selectOption({ label: "Pance (IDEAM (datos.gov.co))" });
  await page.locator(".lienzo").waitFor();
  await page.getByRole("button", { name: "Todo" }).click();
  await expect(ciclo.locator(".nota")).toContainText("93 días o menos");
});

test("las horas marcadas como no confiables no entran en el promedio y se cuentan aparte", async ({ page }) => {
  await instalarApi(page);
  // Un sensor detenido en 0: diez horas válidas de 20 µg/m³ y diez repetidas en 0.
  await page.route(/\/api\/estaciones\/\d+\/series\?/, (route) => {
    const inicio = Date.parse("2026-10-01T05:00:00Z");
    const datos = Array.from({ length: 20 }, (_, i) => ({
      instante: new Date(inicio + i * 3600000).toISOString(), valor: i < 10 ? 20 : 0,
      bandera: i < 10 ? "valido" : "sospechoso", anomalia: false, puntaje_anomalia: null,
    }));
    return route.fulfill({ json: { estacion: { id: 1, nombre: "Prueba", fuente: "SATIC (red OAC22)" }, parametro: "PM25",
                                   agregacion: "hora", datos } });
  });
  await abrirVisor(page);
  await irA(page, "Histórico");
  await page.locator(".lienzo").waitFor();
  const cifras = page.locator(".cifras");
  await expect(cifras).toContainText("Promedio del periodo20 µg/m³");
  await expect(cifras).toContainText("Horas con dato10");
  await expect(cifras).toContainText("No confiables10");
  await page.getByRole("button", { name: "Ver los datos como tabla" }).click();
  await expect(page.locator(".tabla-datos tbody")).toContainText("0 (no confiable: valor repetido)");
});
