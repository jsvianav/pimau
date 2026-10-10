"""API de consulta (capa de servicios, incremento 2: RF-05 a RF-09).

Solo lee la base de datos. No llama a la ingesta ni a las fuentes externas
(ADR-01 y ADR-04). La documentacion OpenAPI queda en /api/docs (RF-08).
"""
import csv
import io
import time
from collections import defaultdict, deque
from datetime import date
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from pimau.api import consultas
from pimau.db.sesion import Sesion

app = FastAPI(
    title="PIMAU API",
    description="Consulta de los datos ambientales integrados de Santiago de Cali. "
                "Cada dato incluye su fuente, su fecha y su bandera de calidad.",
    version="0.2.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

MAXIMO_DIAS_HORARIO = 93
SOLICITUDES_POR_MINUTO = 120
DURACION_CACHE_S = 600

Parametro = Literal["PM25", "PM10"]
Agregacion = Literal["hora", "dia"]


def sesion_bd():
    with Sesion() as sesion:
        yield sesion


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
@app.get("/api/salud", summary="Estado del servicio")
def salud():
    return {"estado": "ok"}


@app.get("/api/parametros", summary="Parámetros disponibles")
def listar_parametros(sesion: Session = Depends(sesion_bd)):
    return consultas.parametros(sesion)


@app.get("/api/umbrales", summary="Puntos de corte del ICA y guías de la OMS")
def listar_umbrales(sesion: Session = Depends(sesion_bd)):
    return _en_cache("umbrales", lambda: consultas.umbrales(sesion))


@app.get("/api/estaciones", summary="Estaciones con su último estado (RF-05, RF-07)")
def listar_estaciones(sesion: Session = Depends(sesion_bd)):
    """GeoJSON con la última medición válida de cada estación, el promedio de
    24 horas, su categoría del ICA y el valor guía de la OMS."""
    return _en_cache("estaciones", lambda: consultas.estaciones(sesion))


def _validar(sesion, estacion_id, desde, hasta, agregacion):
    estacion = consultas.estacion_existe(sesion, estacion_id)
    if estacion is None:
        raise HTTPException(404, "La estación no existe")
    if hasta < desde:
        raise HTTPException(422, "La fecha final debe ser posterior a la inicial")
    if agregacion == "hora" and (hasta - desde).days > MAXIMO_DIAS_HORARIO:
        raise HTTPException(422, f"La serie horaria admite hasta {MAXIMO_DIAS_HORARIO} días. "
                                 "Use agregacion=dia para rangos más largos.")
    return estacion


@app.get("/api/estaciones/{estacion_id}/rango", summary="Fechas disponibles de una serie")
def rango(estacion_id: int, parametro: Parametro = "PM25", sesion: Session = Depends(sesion_bd)):
    resultado = consultas.rango_disponible(sesion, estacion_id, parametro)
    if resultado is None:
        raise HTTPException(404, "No hay datos de ese parámetro en la estación")
    return resultado


@app.get("/api/estaciones/{estacion_id}/series", summary="Serie histórica (RF-06)")
def serie(estacion_id: int, parametro: Parametro = "PM25",
          desde: date = Query(..., description="Día inicial (hora de Colombia)"),
          hasta: date = Query(..., description="Día final, incluido"),
          agregacion: Agregacion = "hora", sesion: Session = Depends(sesion_bd)):
    estacion = _validar(sesion, estacion_id, desde, hasta, agregacion)
    datos = (consultas.serie_horaria if agregacion == "hora" else consultas.serie_diaria)(
        sesion, estacion_id, parametro, desde, hasta)
    return {"estacion": estacion, "parametro": parametro, "agregacion": agregacion, "datos": datos}


@app.get("/api/estaciones/{estacion_id}/series.csv", summary="Descarga de la serie en CSV (RF-08)")
def serie_csv(estacion_id: int, parametro: Parametro = "PM25",
              desde: date = Query(...), hasta: date = Query(...),
              agregacion: Agregacion = "hora", sesion: Session = Depends(sesion_bd)):
    estacion = _validar(sesion, estacion_id, desde, hasta, agregacion)
    datos = (consultas.serie_horaria if agregacion == "hora" else consultas.serie_diaria)(
        sesion, estacion_id, parametro, desde, hasta)
    salida = io.StringIO()
    escritor = csv.writer(salida)
    escritor.writerow(["estacion", "fuente", "parametro", "unidad",
                       "instante" if agregacion == "hora" else "dia", "valor", "bandera"])
    for d in datos:
        escritor.writerow([estacion["nombre"], estacion["fuente"], parametro, "µg/m³",
                           d.get("instante") or d.get("dia"), "" if d["valor"] is None else d["valor"],
                           d["bandera"]])
    nombre = f"pimau_{estacion_id}_{parametro}_{desde}_{hasta}.csv"
    return StreamingResponse(iter([salida.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{nombre}"'})


@app.get("/api/capas/{tipo}", summary="Capas territoriales (RF-09)")
def capa(tipo: Literal["comuna", "barrio", "corregimiento"], sesion: Session = Depends(sesion_bd)):
    return _en_cache(f"capa-{tipo}", lambda: consultas.capa(sesion, tipo))
