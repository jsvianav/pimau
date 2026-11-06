// Reflujo (WCAG 1.4.10): ninguna vista se desborda de lado, del celular más
// angosto a una pantalla ancha. Cubre los dos errores de la auditoría del
// 2026-11-04: el riel del marcador del ICA, que ensanchaba la página, y el
// nombre que se encimaba con el estado en la lista.
import { expect, test } from "@playwright/test";
import { abrirVisor, elegirEstacion, instalarApi, irA } from "./api-simulada.js";

const ANCHOS = [320, 375, 768, 1280];

async function anchoDePagina(page) {
  return page.evaluate(() => ({ documento: document.documentElement.scrollWidth, ventana: document.documentElement.clientWidth }));
}

for (const ancho of ANCHOS) {
  test.describe(`${ancho} px`, () => {
    test.use({ viewport: { width: ancho, height: 800 }, isMobile: ancho < 768, hasTouch: ancho < 768 });

    test("mapa con fichas de ICA alto y la categoría más larga", async ({ page }) => {
      await instalarApi(page, { caso: "peor" });
      await abrirVisor(page);
      for (const nombre of ["Institución Educativa", "Colegio Nuestra Señora", "San Martín"]) {
        await elegirEstacion(page, nombre);
        const { documento, ventana } = await anchoDePagina(page);
        expect(documento, `con ${nombre}`).toBeLessThanOrEqual(ventana);
      }
    });

    test("histórico con una serie", async ({ page }) => {
      await instalarApi(page);
      await abrirVisor(page);
      await irA(page, "Histórico");
      await page.locator(".lienzo").waitFor();
      const { documento, ventana } = await anchoDePagina(page);
      expect(documento).toBeLessThanOrEqual(ventana);
    });

    test("panel de administración", async ({ page }) => {
      await instalarApi(page, { caso: "peor", sesion: true });
      await abrirVisor(page);
      await irA(page, "Administración");
      await page.locator(".tabla-auditoria").waitFor();
      const { documento, ventana } = await anchoDePagina(page);
      expect(documento).toBeLessThanOrEqual(ventana);
    });
  });
}

test.describe("panel lateral de escritorio", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("no se desplaza de lado con ningún ICA", async ({ page }) => {
    await instalarApi(page, { caso: "peor" });
    await abrirVisor(page);
    for (const nombre of ["Institución Educativa", "San Martín", "Valle del Lili"]) {
      await elegirEstacion(page, nombre);
      const panel = await page.locator(".panel-lateral").evaluate((p) => ({ contenido: p.scrollWidth, visible: p.clientWidth }));
      expect(panel.contenido, `con ${nombre}`).toBeLessThanOrEqual(panel.visible);
    }
  });

  test("el marcador queda dentro de la barra, en su valor", async ({ page }) => {
    await instalarApi(page, { caso: "peor" });
    await abrirVisor(page);
    await elegirEstacion(page, "Institución Educativa");
    const { izquierda, ancho } = await page.locator(".escala-barra").evaluate((barra) => {
      const marcador = barra.querySelector(".escala-marcador").getBoundingClientRect();
      const caja = barra.getBoundingClientRect();
      return { izquierda: marcador.left + marcador.width / 2 - caja.left, ancho: caja.width };
    });
    // ICA 500: el centro del marcador va en el extremo derecho de la barra.
    expect(Math.abs(izquierda - ancho)).toBeLessThan(2);
  });
});

// En portátiles comunes la leyenda tapaba las casillas de los límites del
// territorio, que seguían recibiendo el foco (WCAG 2.4.11 y 2.5.8).
for (const [ancho, alto] of [[1366, 768], [1280, 800], [1280, 720]]) {
  test(`a ${ancho} × ${alto} la leyenda no tapa los controles del mapa`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: alto });
    await instalarApi(page);
    await abrirVisor(page);
    const tapados = await page.locator(".controles-mapa input, .controles-mapa select").evaluateAll((controles) => controles
      .filter((control) => {
        const caja = control.getBoundingClientRect();
        const encima = document.elementFromPoint(caja.left + caja.width / 2, caja.top + caja.height / 2);
        return !(encima === control || control.closest("label")?.contains(encima));
      })
      .map((control) => control.closest("label")?.innerText.trim() || control.tagName));
    expect(tapados).toEqual([]);
  });
}

test.describe("lista de estaciones", () => {
  for (const ancho of [320, 375]) {
    test(`a ${ancho} px el nombre no se monta sobre el estado`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 800 });
      await instalarApi(page);
      await abrirVisor(page);
      await elegirEstacion(page, "Universidad Libre");
      const encimados = await page.locator(".lista .texto-estacion").evaluateAll((filas) => filas.filter((fila) => {
        const [nombre, estado] = [...fila.children].map((e) => e.getBoundingClientRect());
        return nombre.right > estado.left + 1 && nombre.bottom > estado.top + 1 && nombre.top < estado.bottom - 1;
      }).length);
      expect(encimados).toBe(0);
    });
  }
});

// El CSS de MapLibre se carga en diferido, después de estilos.css: si alguna de
// sus reglas vuelve a ganarle a las nuestras, el mapa queda sin alto o los
// botones de zoom quedan debajo del panel. Pasó en la fase 6 sin que nada fallara.
for (const [nombre, opciones] of [["escritorio", { viewport: { width: 1280, height: 800 } }],
  ["celular", { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }]]) {
  test.describe(`mapa en ${nombre}`, () => {
    test.use(opciones);
    test("ocupa su contenedor y tiene lienzo", async ({ page }) => {
      await instalarApi(page);
      await abrirVisor(page);
      await page.locator(".maplibregl-canvas").waitFor();
      const medidas = await page.evaluate(() => {
        const mapa = document.querySelector(".maplibregl-map").getBoundingClientRect();
        const contenedor = document.querySelector(".mapa-contenedor").getBoundingClientRect();
        const lienzo = document.querySelector(".maplibregl-canvas").getBoundingClientRect();
        const zoom = document.querySelector(".maplibregl-ctrl-bottom-right").getBoundingClientRect();
        return { mapa: mapa.height, contenedor: contenedor.height, lienzo: lienzo.height,
                 zoomDerecha: window.innerWidth - zoom.right, ancho: window.innerWidth };
      });
      expect(medidas.mapa).toBeGreaterThan(200);
      expect(Math.abs(medidas.mapa - medidas.contenedor)).toBeLessThan(2);
      expect(Math.abs(medidas.lienzo - medidas.mapa)).toBeLessThan(2);
      // En escritorio los botones de zoom quedan a la izquierda del panel (360 px más márgenes).
      if (medidas.ancho > 900) expect(medidas.zoomDerecha).toBeGreaterThanOrEqual(380);
    });
  });
}
