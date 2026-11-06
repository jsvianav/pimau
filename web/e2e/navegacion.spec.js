// Estado en la URL, «Atrás», búsqueda en la lista, salto al panel y enlace de
// cada estación (fase 3 del plan de mejora).
import { expect, test } from "@playwright/test";
import { abrirVisor, elegirEstacion, instalarApi, irA } from "./api-simulada.js";

test.use({ viewport: { width: 1280, height: 800 } });

test("un enlace abre la estación y la variable que nombra", async ({ page }) => {
  await instalarApi(page);
  await page.goto("/?estacion=universidad-libre&variable=PM10");
  await expect(page.locator("#titulo-ficha")).toHaveText("Universidad Libre");
  await expect(page.locator(".controles-mapa select")).toHaveValue("PM10");
});

test("elegir estaciones agrega pasos que «Atrás» deshace", async ({ page }) => {
  await instalarApi(page);
  await abrirVisor(page);
  await elegirEstacion(page, "Universidad Libre");
  await expect(page).toHaveURL(/\?estacion=universidad-libre$/);
  await elegirEstacion(page, "San Martín");
  await expect(page).toHaveURL(/\?estacion=san-martin$/);
  await page.goBack();
  await expect(page.locator("#titulo-ficha")).toHaveText("Universidad Libre");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Elija una estación" })).toBeVisible();
  await page.goForward();
  await expect(page.locator("#titulo-ficha")).toHaveText("Universidad Libre");
});

test("la variable y la vigencia cambian la URL sin agregar pasos", async ({ page }) => {
  await instalarApi(page);
  await abrirVisor(page);
  await elegirEstacion(page, "Universidad Libre");
  await page.locator(".controles-mapa select").selectOption("PM10");
  await page.getByLabel("Todo el histórico").check();
  await expect(page).toHaveURL(/estacion=universidad-libre&variable=PM10&vigencia=todo$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Elija una estación" })).toBeVisible();
});

test("de la ficha al histórico y de vuelta con «Atrás»", async ({ page }) => {
  await instalarApi(page);
  await abrirVisor(page);
  await elegirEstacion(page, "Universidad Libre");
  await page.getByRole("button", { name: "Ver el histórico de esta fuente" }).click();
  await expect(page.locator(".lienzo")).toBeVisible();
  await expect(page).toHaveURL(/vista=historico&serie=9&variable=PM25&desde=\d{4}-\d{2}-\d{2}&hasta=/);
  await page.goBack();
  await expect(page.locator("#titulo-ficha")).toHaveText("Universidad Libre");
});

test("un enlace del histórico abre la serie y el periodo que nombra", async ({ page }) => {
  await instalarApi(page);
  await page.goto("/?vista=historico&serie=9&variable=PM25&desde=2026-10-01&hasta=2026-10-15");
  await expect(page.getByRole("heading", { name: "PM2.5 en Universidad Libre (SATIC (red OAC22))" })).toBeVisible();
  await expect(page.getByLabel("Desde")).toHaveValue("2026-10-01");
  await expect(page.getByLabel("Hasta")).toHaveValue("2026-10-15");
});

test("un enlace viejo no deja el mapa en un estado imposible", async ({ page }) => {
  await instalarApi(page);
  await page.goto("/?estacion=estacion-que-no-existe&variable=XYZ");
  await expect(page.getByRole("heading", { name: "Elija una estación" })).toBeVisible();
  await expect(page.locator(".controles-mapa select")).toHaveValue("PM25");
  await expect(page).toHaveURL(/\/$/);
});

test("la búsqueda filtra la lista y su estado vacío ofrece borrarla", async ({ page }) => {
  await instalarApi(page);
  await abrirVisor(page);
  const buscar = page.getByLabel("Buscar una estación");
  await buscar.fill("universidad");
  await expect(page.locator(".lista li")).toHaveCount(4);
  await buscar.fill("libre");
  await expect(page.locator(".lista li")).toHaveCount(1);
  await buscar.fill("zzz");
  await expect(page.getByText("Ninguna estación coincide con «zzz».")).toBeVisible();
  await page.getByRole("button", { name: "Borrar la búsqueda" }).click();
  await expect(buscar).toHaveValue("");
  await expect(page.locator(".lista li")).toHaveCount(12);
});

test("el primer Tab ofrece saltar a la lista de estaciones", async ({ page }) => {
  await instalarApi(page);
  await abrirVisor(page);
  await page.keyboard.press("Tab");
  const saltar = page.getByRole("link", { name: "Saltar a la lista de estaciones" });
  await expect(saltar).toBeFocused();
  await expect(saltar).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("#lista-estaciones")).toBeFocused();
});

test("copiar el enlace de una estación", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await instalarApi(page);
  await abrirVisor(page);
  await elegirEstacion(page, "Universidad Libre");
  await page.getByRole("button", { name: "Copiar el enlace de esta estación" }).click();
  await expect(page.locator(".copiar-enlace [role=status]")).toHaveText("Enlace copiado.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\?estacion=universidad-libre$/);
});

test("la pestaña Histórico reabre la última consulta", async ({ page }) => {
  await instalarApi(page);
  await abrirVisor(page);
  await elegirEstacion(page, "San Martín");
  await page.getByRole("button", { name: "Ver el histórico de esta fuente" }).click();
  await expect(page.getByRole("heading", { name: /PM2\.5 en San Martín/ })).toBeVisible();
  await irA(page, "Mapa");
  await irA(page, "Histórico");
  await expect(page.getByRole("heading", { name: /PM2\.5 en San Martín/ })).toBeVisible();
});

test("«Acerca de» se abre desde el panel y tiene su propia dirección", async ({ page }) => {
  await instalarApi(page);
  await abrirVisor(page);
  await page.getByRole("button", { name: "Acerca de los datos" }).click();
  await expect(page.getByRole("heading", { name: "Acerca de PIMAU" })).toBeVisible();
  await expect(page).toHaveURL(/vista=acerca/);
  await expect(page).toHaveTitle("Acerca de · PIMAU");
  await expect(page.getByRole("link", { name: "documentación interactiva de la API" })).toHaveAttribute("href", "/api/docs");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Acerca de PIMAU" })).toHaveCount(0);
});
