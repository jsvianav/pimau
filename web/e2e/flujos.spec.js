// Flujos principales del visor con teclado y con la API simulada.
import { expect, test } from "@playwright/test";
import { abrirVisor, elegirEstacion, instalarApi, irA } from "./api-simulada.js";

test.use({ viewport: { width: 1280, height: 800 } });

test("elegir una estación con el teclado lleva el foco a su ficha", async ({ page }) => {
  await instalarApi(page);
  await abrirVisor(page);
  await page.locator(".lista button", { hasText: "Universidad Libre" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#titulo-ficha")).toBeFocused();
  await expect(page.locator("#titulo-ficha")).toHaveText("Universidad Libre");
  await expect(page.locator(".escala-categoria strong")).toHaveText("Dañina a la salud de grupos sensibles");
});

test("el selector del mapa usa nombres cortos y la leyenda el completo", async ({ page }) => {
  await instalarApi(page);
  await abrirVisor(page);
  await expect(page.locator(".controles-mapa select option:checked")).toHaveText("PM2.5");
  await expect(page.locator(".leyenda.flotante")).toContainText("Material particulado PM2.5");
});

test("cada sección tiene su título de página", async ({ page }) => {
  await instalarApi(page);
  await abrirVisor(page);
  await expect(page).toHaveTitle("PIMAU · Calidad del aire en Cali");
  await irA(page, "Histórico");
  await expect(page).toHaveTitle("Histórico · PIMAU");
  await irA(page, "Administración");
  await expect(page).toHaveTitle("Administración · PIMAU");
});

test("de la ficha al histórico de la fuente, con su tabla", async ({ page }) => {
  await instalarApi(page);
  await abrirVisor(page);
  await elegirEstacion(page, "Universidad Libre");
  await page.getByRole("button", { name: "Ver el histórico de esta fuente" }).click();
  await expect(page.getByRole("heading", { name: "PM2.5 en Universidad Libre (SATIC (red OAC22))" })).toBeVisible();
  await page.getByRole("button", { name: "Ver los datos como tabla" }).click();
  await expect(page.locator(".tabla-datos tbody tr").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Descargar los datos en CSV" })).toHaveAttribute("href", /series\.csv\?parametro=PM25/);
});

test("la gráfica de 48 horas se carga solo al abrir una estación reciente", async ({ page }) => {
  const graficas = [];
  page.on("request", (peticion) => { if (/graficas-.*\.js$/.test(peticion.url())) graficas.push(peticion.url()); });
  await instalarApi(page);
  await abrirVisor(page);
  expect(graficas).toHaveLength(0);
  await elegirEstacion(page, "Universidad Libre");
  await expect(page.locator(".ultimas-horas")).toBeVisible();
  expect(graficas).toHaveLength(1);
});

test("administración: guardar una fila deja el foco en su botón", async ({ page }) => {
  await instalarApi(page);
  await abrirVisor(page);
  await irA(page, "Administración");
  await page.getByLabel("Correo").fill("admin@ejemplo.org");
  await page.getByLabel("Contraseña").fill("clave-de-prueba");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.getByLabel("Frecuencia de Datos Abiertos de Cali").selectOption("60");
  const guardar = page.getByRole("button", { name: "Guardar cambios (Datos Abiertos de Cali)" });
  await guardar.click();
  const guardado = page.getByRole("button", { name: "Guardado (Datos Abiertos de Cali)" });
  await expect(guardado).toBeVisible();
  await expect(guardado).toBeFocused();
  await expect(page.getByRole("status")).toContainText("Cambios guardados en Datos Abiertos de Cali");
});
