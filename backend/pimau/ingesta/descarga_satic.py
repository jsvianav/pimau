"""Descarga automática de SATIC (red OAC22).

SATIC no tiene una API pública: su geoportal (https://satic.cali.gov.co) solo
deja descargar, desde la gráfica de cada estación, un Excel por variable. Este
proceso hace eso mismo con un navegador automatizado: abre el geoportal, acepta
los términos de uso, recorre las estaciones de calidad del aire y guarda cada
variable en la bandeja que lee el conector satic.py.

Corre en su propio contenedor (descarga-satic) porque necesita un navegador.
Cada archivo se guarda con un nombre fijo por estación y variable, así que cada
descarga reemplaza a la anterior y la bandeja no crece. El conector no pierde
nada: las horas ya cargadas quedan en la base.

    python -m pimau.ingesta.descarga_satic [--cada MINUTOS] [--rango "Últimas 24 horas"]

Es frágil por naturaleza: si SATIC cambia su página, la descarga falla. El
error queda en el registro del contenedor y la ingesta sigue con los archivos
que ya tiene (escenario 6).
"""
import argparse
import json
import logging
import os
import re
import time
from datetime import datetime, timezone  # timezone.utc: la imagen de Playwright trae Python 3.10
from pathlib import Path

from pimau.config import configuracion

log = logging.getLogger("pimau.descarga_satic")

URL = "https://satic.cali.gov.co/"
RANGOS = ("Últimas 24 horas", "Últimas 48 horas", "Últimas 72 horas",
          "Últimos 7 días", "Últimos 15 días", "Últimos 30 días")

# Ubica el mapa Leaflet de la página (dentro del estado de React) y devuelve las
# estaciones de calidad del aire con su nombre y su posición.
_JS_ESTACIONES = """() => {
  const cont = document.querySelector('.leaflet-container');
  let fiber = cont[Object.keys(cont).find(k => k.startsWith('__reactFiber'))], mapa = null;
  for (let i = 0; i < 60 && fiber && !mapa; i++) {
    let st = fiber.memoizedState;
    while (st && !mapa) {
      const m = st.memoizedState;
      if (m && m._layers && m.getCenter) mapa = m;
      else if (m && m.current && m.current._layers) mapa = m.current;
      else if (m && m.map && m.map._layers) mapa = m.map;
      st = st.next;
    }
    fiber = fiber.return;
  }
  const textos = (n, acc) => {
    if (n == null || typeof n === 'boolean') return acc;
    if (typeof n === 'string' || typeof n === 'number') { acc.push(String(n)); return acc; }
    if (Array.isArray(n)) { n.forEach(x => textos(x, acc)); return acc; }
    if (n.props) textos(n.props.children, acc);
    return acc;
  };
  window.__mapaSatic = mapa;
  return Object.values(mapa._layers)
    .filter(l => l.getLatLng && l._icon && l._icon.outerHTML.includes('aire'))
    .map(l => {
      const t = textos(l.options.children, []).map(s => s.trim()).filter(Boolean);
      const k = t.indexOf('Nombre Estación:');
      return { nombre: k >= 0 ? t[k + 1] : null, lat: l.getLatLng().lat, lon: l.getLatLng().lng };
    });
}"""

_JS_ABRIR = """({ lat, lon }) => {
  const capa = Object.values(window.__mapaSatic._layers)
    .find(l => l.getLatLng && l.getLatLng().lat === lat && l.getLatLng().lng === lon);
  capa.fire('click', { latlng: capa.getLatLng() });
}"""

# Títulos de todas las gráficas de la estación, en el mismo orden que sus botones
# de descarga. Desde noviembre de 2026 SATIC muestra el mínimo, el promedio y el
# máximo de cada variable; antes solo los promedios.
_JS_TITULOS = """() => [...document.querySelectorAll('*')]
  .filter(x => x.children.length === 0 && /^[A-Z0-9]+_[A-Z]+ - .+\\(/.test(x.textContent.trim()))
  .map(x => x.textContent.trim())"""


def series_a_descargar(titulos: list[str]) -> list[int]:
    """Posiciones de las gráficas que se descargan: solo los promedios (_AVG).

    El título y el botón de cada gráfica van en el mismo orden, así que la
    posición del título es la del botón. Antes se tomaban solo los títulos de
    los promedios y se emparejaban con los primeros botones: cuando SATIC agregó
    los mínimos y los máximos, el archivo «PM25_AVG» traía la temperatura mínima.
    """
    return [k for k, t in enumerate(titulos) if t.split(" - ")[0].endswith("_AVG")]


# Resultado del ultimo intento, en la misma bandeja. La ingesta lo lee para que
# el panel del administrador muestre si la descarga esta fallando (RF-11).
ARCHIVO_ESTADO = "_estado_descarga.json"


def guardar_estado(destino: Path, archivos: int, error: str | None, ahora: datetime | None = None):
    ruta = destino / ARCHIVO_ESTADO
    try:
        anterior = json.loads(ruta.read_text())
    except (OSError, ValueError):
        anterior = {}
    ahora = (ahora or datetime.now(timezone.utc)).isoformat()  # noqa: UP017
    exito_previo = anterior.get("ultimo_exito")
    if exito_previo is None:
        # Antes de existir este archivo, el ultimo exito es el Excel mas reciente.
        fechas = [a.stat().st_mtime for a in destino.glob("*.xlsx")]
        if fechas:
            exito_previo = datetime.fromtimestamp(max(fechas), timezone.utc).isoformat()  # noqa: UP017
    estado = {"ultimo_intento": ahora, "archivos": archivos, "error": error,
              "ultimo_exito": ahora if error is None else exito_previo}
    temporal = ruta.with_suffix(".parcial")
    temporal.write_text(json.dumps(estado, ensure_ascii=False))
    os.replace(temporal, ruta)


def nombre_archivo(titulo: str) -> str:
    """'PM25_AVG - USB (PM25_AVG)' -> 'PM25_AVG_-_USB.xlsx'. El nombre es fijo
    por estación y variable para que cada descarga reemplace a la anterior."""
    serie = titulo.split(" (")[0].strip()
    return re.sub(r"[^A-Za-z0-9_-]+", "_", serie) + ".xlsx"


def descargar(destino: Path, rango: str = "Últimas 24 horas") -> int:
    """Descarga todas las variables de todas las estaciones de aire. Devuelve
    cuántos archivos guardó."""
    from playwright.sync_api import sync_playwright  # solo existe en este contenedor

    destino.mkdir(parents=True, exist_ok=True)
    guardados = 0
    with sync_playwright() as pw:
        navegador = pw.chromium.launch(headless=True)
        # SATIC muestra las horas en la zona del navegador: se fija la de Colombia
        # para que los archivos sean iguales a una descarga manual hecha en Cali
        # (configuracion.satic_zona_horaria).
        contexto = navegador.new_context(accept_downloads=True, viewport={"width": 1440, "height": 900},
                                         timezone_id="America/Bogota")
        pagina = contexto.new_page()

        def abrir_portal():
            pagina.goto(URL, wait_until="domcontentloaded", timeout=60_000)
            pagina.wait_for_selector(".leaflet-marker-icon", timeout=60_000)
            casilla = pagina.get_by_text("Acepto los términos y condiciones")
            if casilla.count():
                casilla.click()
                pagina.get_by_role("button", name="Aceptar").click()
            pagina.wait_for_timeout(3000)
            return pagina.evaluate(_JS_ESTACIONES)

        for estacion in abrir_portal():
            try:
                # La página se recarga por estación: al abrir una, el mapa
                # recrea sus marcadores y ya no se pueden seguir usando.
                abrir_portal()
                pagina.evaluate(_JS_ABRIR, estacion)
                pagina.get_by_text("Estación " + estacion["nombre"], exact=True).wait_for(timeout=20_000)
                pagina.get_by_role("combobox").click()
                pagina.get_by_role("option", name=rango).click()
                pagina.wait_for_timeout(2000)
                pagina.wait_for_function(
                    "() => document.querySelectorAll('svg.highcharts-root').length > 0"
                    " || /No hay datos disponibles/.test(document.body.innerText)", timeout=60_000)
                pagina.wait_for_timeout(2000)
                titulos = pagina.evaluate(_JS_TITULOS)
                botones = pagina.locator("button.ml-5")
                if botones.count() != len(titulos):
                    # Sin la misma cantidad no se sabe qué botón es de qué gráfica:
                    # se omite la estación antes que guardar una variable con otro nombre.
                    log.warning("%s: %s gráficas y %s botones; no se descarga", estacion["nombre"],
                                len(titulos), botones.count())
                    continue
                for k in series_a_descargar(titulos):
                    with pagina.expect_download(timeout=60_000) as espera:
                        botones.nth(k).click()
                    # Se guarda con otro nombre y se renombra al final, para que
                    # la ingesta nunca lea un archivo a medio escribir.
                    final = destino / nombre_archivo(titulos[k])
                    temporal = final.with_suffix(".xlsx.parcial")
                    espera.value.save_as(temporal)
                    os.replace(temporal, final)
                    guardados += 1
                    pagina.wait_for_timeout(800)
                log.info("%s: %s variables", estacion["nombre"], len(series_a_descargar(titulos)))
            except Exception:
                log.warning("No se pudo descargar %s", estacion["nombre"], exc_info=True)
        navegador.close()
    return guardados


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    argumentos = argparse.ArgumentParser(prog="pimau.ingesta.descarga_satic")
    argumentos.add_argument("--cada", type=int, default=0, help="Repetir cada N minutos (0: una sola vez)")
    argumentos.add_argument("--rango", default="Últimas 24 horas", choices=RANGOS)
    opciones = argumentos.parse_args()
    destino = Path(configuracion.satic_bandeja)
    while True:
        inicio = time.monotonic()
        try:
            total = descargar(destino, opciones.rango)
            log.info("Descarga de SATIC terminada: %s archivos en %s", total, destino)
            guardar_estado(destino, total, None if total else "No se descargó ningún archivo")
        except Exception as error:
            log.exception("La descarga de SATIC falló; se reintenta en la próxima ejecución")
            guardar_estado(destino, 0, f"{type(error).__name__}: {str(error).splitlines()[0][:300]}")
        if not opciones.cada:
            return
        time.sleep(max(60, opciones.cada * 60 - (time.monotonic() - inicio)))


if __name__ == "__main__":
    main()
