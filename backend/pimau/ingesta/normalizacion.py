"""Reglas de normalizacion (RF-02) y de calidad (RF-03).

La ingesta no elimina ni rellena datos. Cada valor se guarda con una bandera:
valido, faltante o fuera_de_rango.
"""
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from pimau.config import configuracion

ZONA_FUENTES = ZoneInfo(configuracion.zona_horaria_fuentes)

# Rango fisico posible por parametro, en µg/m³. Un valor fuera de este rango
# casi siempre es un error del sensor (Capitulo 2, deteccion de anomalias).
RANGOS_FISICOS = {
    "PM25": (0.0, 1000.0),
    "PM10": (0.0, 2000.0),
}

# Textos con los que las fuentes indican un dato ausente.
TEXTOS_FALTANTE = {"", "nd", "n/d", "na", "n/a", "-", "--", "sin dato", "null", "none"}

_PATRONES_PARAMETRO = [
    (re.compile(r"^\s*pm\s*2[.,]?5", re.IGNORECASE), "PM25"),
    (re.compile(r"^\s*pm\s*10", re.IGNORECASE), "PM10"),
]

_FORMATOS_FECHA = (
    "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%m/%d/%Y %H:%M",
    "%m/%d/%Y %H:%M:%S",
)


def codigo_parametro(nombre_origen: str) -> str | None:
    """Traduce el nombre de una columna o variable de origen a un codigo comun."""
    for patron, codigo in _PATRONES_PARAMETRO:
        if patron.search(nombre_origen):
            return codigo
    return None


def leer_numero(texto) -> float | None:
    """Convierte un valor de origen en numero. Devuelve None si el dato falta."""
    if texto is None:
        return None
    if isinstance(texto, (int, float)):
        return float(texto)
    limpio = str(texto).strip()
    if limpio.lower() in TEXTOS_FALTANTE:
        return None
    if "," in limpio and "." in limpio:
        # Formato con separador de miles, por ejemplo 1.234,5
        if limpio.rfind(",") > limpio.rfind("."):
            limpio = limpio.replace(".", "").replace(",", ".")
        else:
            limpio = limpio.replace(",", "")
    elif "," in limpio:
        limpio = limpio.replace(",", ".")
    try:
        return float(limpio)
    except ValueError:
        return None


# Origen de los numeros de serie de fecha de Excel.
_ORIGEN_EXCEL = datetime(1899, 12, 30)
_PATRON_SERIE_EXCEL = re.compile(r"^\d{5}([.,]\d+)?$")


def leer_fecha(texto: str) -> datetime:
    """Interpreta una fecha local de la fuente y la devuelve en UTC (ISO 8601).

    Acepta texto en varios formatos y numeros de serie de Excel (por ejemplo
    41646 o 41646,04167, con coma decimal), que aparecen en algunos archivos
    del portal de Cali.
    """
    limpio = str(texto).strip()
    if _PATRON_SERIE_EXCEL.match(limpio):
        local = _ORIGEN_EXCEL + timedelta(days=float(limpio.replace(",", ".")))
        local = local.replace(second=0, microsecond=0) + timedelta(minutes=round(local.second / 60))
        return local.replace(tzinfo=ZONA_FUENTES).astimezone(timezone.utc)
    for formato in _FORMATOS_FECHA:
        try:
            local = datetime.strptime(limpio, formato)
        except ValueError:
            continue
        return local.replace(tzinfo=ZONA_FUENTES).astimezone(timezone.utc)
    raise ValueError(f"Formato de fecha no reconocido: {texto!r}")


def bandera(codigo: str, valor: float | None) -> str:
    """Asigna la bandera de calidad de una medicion (RF-03)."""
    if valor is None:
        return "faltante"
    minimo, maximo = RANGOS_FISICOS.get(codigo, (float("-inf"), float("inf")))
    if valor < minimo or valor > maximo:
        return "fuera_de_rango"
    return "valido"
