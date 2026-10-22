"""API de consulta y administracion (capa de servicios).

La consulta (incremento 2: RF-05 a RF-09) es abierta; la administracion
(incremento 3: RF-10 y RF-11) esta en admin.py y exige iniciar sesion.
Solo usa la base de datos. No llama a la ingesta ni a las fuentes externas
(ADR-01 y ADR-04). La documentacion OpenAPI queda en /api/docs (RF-08).
"""
import csv
import io
import logging
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import date
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from pimau.api import admin, consultas, esquemas
from pimau.db.sesion import Sesion, sesion_bd

log = logging.getLogger("pimau.api")
DURACION_CACHE_S = 600


def _renovar_indicadores():
    """Calcula los indicadores en segundo plano y los deja en la cache (ADR-04).

    El calculo de /api/estaciones recorre millones de mediciones y tarda varios
    segundos. Al hacerlo en segundo plano, ninguna consulta de un usuario
    espera ese calculo (escenario 2).
    """
    while True:
        try:
            with Sesion() as sesion:
                inicio = time.monotonic()
                _cache["estaciones"] = (time.monotonic(), consultas.estaciones(sesion))
                _cache["umbrales"] = (time.monotonic(), consultas.umbrales(sesion))
                log.info("Indicadores renovados en %.1f s", time.monotonic() - inicio)
        except Exception:
            log.exception("No se pudieron renovar los indicadores")
        time.sleep(DURACION_CACHE_S - 60)


@asynccontextmanager
async def ciclo_de_vida(_app):
    threading.Thread(target=_renovar_indicadores, daemon=True, name="indicadores").start()
    yield


app = FastAPI(
    lifespan=ciclo_de_vida,
    title="PIMAU API",
    description="Consulta de los datos ambientales integrados de Santiago de Cali. "
                "Cada dato incluye su fuente, su fecha y su bandera de calidad.",
    version="0.2.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

MAXIMO_DIAS_HORARIO = 93
SOLICITUDES_POR_MINUTO = 120

Agregacion = Literal["hora", "dia"]


# --- Limite de solicitudes por IP (ADR-04, escenario 1) ---------------------
_solicitudes: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def limitar_solicitudes(request: Request, call_next):
    ip = request.client.host if request.client else "desconocida"
    ahora = time.monotonic()
    ventana = _solicitudes[ip]
    while ventana and ahora - ventana[0] > 60:
        ventana.popleft()
    if len(ventana) >= SOLICITUDES_POR_MINUTO:
        return JSONResponse({"detail": "Demasiadas solicitudes. Intente de nuevo en un minuto."},
                            status_code=429)
    ventana.append(ahora)
    return await call_next(request)


# --- Cache en memoria de los indicadores (ADR-04) ---------------------------
_cache: dict[str, tuple[float, object]] = {}


def _en_cache(clave: str, calcular):
    guardado = _cache.get(clave)
    if guardado and time.monotonic() - guardado[0] < DURACION_CACHE_S:
        return guardado[1]
    valor = calcular()
    _cache[clave] = (time.monotonic(), valor)
    return valor


# --- Rutas ------------------------------------------------------------------
@app.get("/api/salud", summary="Estado del servicio", response_model=esquemas.Salud)
def salud():
    return {"estado": "ok"}


@app.get("/api/parametros", summary="Parámetros disponibles", response_model=list[esquemas.Parametro])
def listar_parametros(sesion: Session = Depends(sesion_bd)):
    return consultas.parametros(sesion)


@app.get("/api/umbrales", summary="Puntos de corte del ICA y guías de la OMS",
         response_model=dict[str, esquemas.UmbralesParametro])
def listar_umbrales(sesion: Session = Depends(sesion_bd)):
    return _en_cache("umbrales", lambda: consultas.umbrales(sesion))


@app.get("/api/estaciones", summary="Estaciones con su último estado (RF-05, RF-07)",
         response_model=esquemas.ColeccionEstaciones)
def listar_estaciones(sesion: Session = Depends(sesion_bd)):
    """GeoJSON con la última medición válida de cada estación, el promedio de
    24 horas, su categoría del ICA y el valor guía de la OMS."""
    return _en_cache("estaciones", lambda: consultas.estaciones(sesion))


def _validar_parametro(sesion, parametro: str):
    codigos = _en_cache("codigos", lambda: consultas.codigos_parametros(sesion))
    if parametro not in codigos:
        raise HTTPException(422, f"Parámetro desconocido. Use uno de: {', '.join(sorted(codigos))}")


def _validar(sesion, estacion_id, parametro, desde, hasta, agregacion):
    _validar_parametro(sesion, parametro)
    estacion = consultas.estacion_existe(sesion, estacion_id)
    if estacion is None:
        raise HTTPException(404, "La estación no existe")
    if hasta < desde:
        raise HTTPException(422, "La fecha final debe ser posterior a la inicial")
    if agregacion == "hora" and (hasta - desde).days > MAXIMO_DIAS_HORARIO:
        raise HTTPException(422, f"La serie horaria admite hasta {MAXIMO_DIAS_HORARIO} días. "
                                 "Use agregacion=dia para rangos más largos.")
    return estacion


@app.get("/api/estaciones/{estacion_id}/rango", summary="Fechas disponibles de una serie",
         response_model=esquemas.Rango)
def rango(estacion_id: int, parametro: str = "PM25", sesion: Session = Depends(sesion_bd)):
    _validar_parametro(sesion, parametro)
    resultado = consultas.rango_disponible(sesion, estacion_id, parametro)
    if resultado is None:
        raise HTTPException(404, "No hay datos de ese parámetro en la estación")
    return resultado


@app.get("/api/estaciones/{estacion_id}/series", summary="Serie histórica (RF-06)",
         response_model=esquemas.Serie)
def serie(estacion_id: int, parametro: str = "PM25",
          desde: date = Query(..., description="Día inicial (hora de Colombia)"),
          hasta: date = Query(..., description="Día final, incluido"),
          agregacion: Agregacion = "hora", sesion: Session = Depends(sesion_bd)):
    estacion = _validar(sesion, estacion_id, parametro, desde, hasta, agregacion)
    datos = (consultas.serie_horaria if agregacion == "hora" else consultas.serie_diaria)(
        sesion, estacion_id, parametro, desde, hasta)
    return {"estacion": estacion, "parametro": parametro, "agregacion": agregacion, "datos": datos}


@app.get("/api/estaciones/{estacion_id}/series.csv", summary="Descarga de la serie en CSV (RF-08)")
def serie_csv(estacion_id: int, parametro: str = "PM25",
              desde: date = Query(...), hasta: date = Query(...),
              agregacion: Agregacion = "hora", sesion: Session = Depends(sesion_bd)):
    estacion = _validar(sesion, estacion_id, parametro, desde, hasta, agregacion)
    datos = (consultas.serie_horaria if agregacion == "hora" else consultas.serie_diaria)(
        sesion, estacion_id, parametro, desde, hasta)
    salida = io.StringIO()
    escritor = csv.writer(salida)
    unidad = next(p["unidad"] for p in consultas.parametros(sesion) if p["codigo"] == parametro)
    escritor.writerow(["estacion", "fuente", "parametro", "unidad",
                       "instante" if agregacion == "hora" else "dia", "valor", "bandera"])
    for d in datos:
        escritor.writerow([estacion["nombre"], estacion["fuente"], parametro, unidad,
                           d.get("instante") or d.get("dia"), "" if d["valor"] is None else d["valor"],
                           d["bandera"]])
    nombre = f"pimau_{estacion_id}_{parametro}_{desde}_{hasta}.csv"
    return StreamingResponse(iter([salida.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{nombre}"'})


@app.get("/api/capas/{tipo}", summary="Capas territoriales (RF-09)", response_model=esquemas.Capa)
def capa(tipo: Literal["comuna", "barrio", "corregimiento"], sesion: Session = Depends(sesion_bd)):
    return _en_cache(f"capa-{tipo}", lambda: consultas.capa(sesion, tipo))


app.include_router(admin.publico)
app.include_router(admin.protegido)
