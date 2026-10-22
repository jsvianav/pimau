"""Interfaz comun de los conectores (ADR-01).

Cada conector es la correspondencia entre una fuente y el modelo comun
(Capitulo 2, integracion de datos). Agregar una fuente es agregar un
conector, sin tocar el resto del sistema (escenario 3).
"""
import logging
import time
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx

log = logging.getLogger("pimau.ingesta")


@dataclass(frozen=True)
class EstacionOrigen:
    codigo: str
    nombre: str
    latitud: float
    longitud: float


@dataclass(frozen=True)
class RegistroMedicion:
    """Una medicion ya normalizada, lista para guardarse."""
    estacion: EstacionOrigen
    parametro: str
    instante: datetime
    valor: float | None
    bandera: str
    fecha_publicacion: datetime | None = None


def obtener(cliente: httpx.Client, url: str, intentos: int = 3, **kwargs) -> httpx.Response:
    """GET con reintentos ante fallas transitorias de la fuente."""
    for intento in range(1, intentos + 1):
        try:
            respuesta = cliente.get(url, **kwargs)
            if respuesta.status_code < 500:
                respuesta.raise_for_status()
                return respuesta
            respuesta.raise_for_status()
        except (httpx.TransportError, httpx.HTTPStatusError) as error:
            es_transitorio = isinstance(error, httpx.TransportError) or error.response.status_code >= 500
            if not es_transitorio or intento == intentos:
                raise
            log.warning("Reintento %s de %s para %s: %s", intento, intentos, url, error)
            time.sleep(5 * intento)
    raise RuntimeError("inalcanzable")


def fecha_utc(texto_o_segundos) -> datetime | None:
    """Convierte la fecha de actualización que informa una fuente (texto ISO
    sin zona, que las fuentes usan en UTC, o segundos desde 1970) a UTC."""
    if texto_o_segundos in (None, ""):
        return None
    if isinstance(texto_o_segundos, int | float):
        return datetime.fromtimestamp(texto_o_segundos, UTC)
    fecha = datetime.fromisoformat(str(texto_o_segundos))
    return fecha if fecha.tzinfo else fecha.replace(tzinfo=UTC)


class ConectorMediciones:
    """Conector que entrega mediciones normalizadas.

    Las filas que no se pueden ubicar en el tiempo (fecha ilegible) no se
    pueden guardar como medicion. Se cuentan en filas_descartadas y la
    ejecucion las reporta como advertencia, junto con las demas advertencias
    que el conector deje en la lista advertencias.
    """

    # Frecuencia con la que la fuente deberia reportar. Si no es None, la
    # ingesta genera como faltantes los instantes que la fuente no publico.
    frecuencia_esperada: timedelta | None = timedelta(hours=1)

    def __init__(self, cliente: httpx.Client | None = None):
        self.cliente = cliente or httpx.Client(timeout=300, follow_redirects=True)
        self.filas_descartadas = 0
        self.advertencias: list[str] = []

    def extraer(self, desde: datetime | None) -> Iterator[RegistroMedicion]:
        raise NotImplementedError


class ConectorCapas:
    """Conector que entrega capas territoriales."""

    def __init__(self, cliente: httpx.Client | None = None):
        self.cliente = cliente or httpx.Client(timeout=300, follow_redirects=True)

    def extraer(self):
        raise NotImplementedError
