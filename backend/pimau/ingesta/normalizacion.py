"""Reglas de normalizacion (RF-02) y de calidad (RF-03).

La ingesta no elimina ni rellena datos. Cada valor se guarda con una bandera:
valido, faltante o fuera_de_rango.
"""
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from pimau.config import configuracion

ZONA_FUENTES = ZoneInfo(configuracion.zona_horaria_fuentes)

# Rango fisico posible por parametro, en la unidad comun. Un valor fuera de
# este rango casi siempre es un error del sensor (Capitulo 2, deteccion de
# anomalias). La humedad admite hasta 105 % porque los sensores marcan algo mas
# de 100 % en saturacion.
RANGOS_FISICOS = {
    # Contaminantes, µg/m³
    "PM25": (0.0, 1000.0),
    "PM10": (0.0, 2000.0),
    "O3": (0.0, 1200.0),
    "NO2": (0.0, 4000.0),
    "SO2": (0.0, 3000.0),
    "CO": (0.0, 60000.0),
    "H2S": (0.0, 1000.0),
    # Meteorologia
    "TEMP": (-5.0, 50.0),      # °C
    "HUM": (0.0, 105.0),       # %
    "VV": (0.0, 60.0),         # m/s
    "DV": (0.0, 360.0),        # grados
    "LLUVIA": (0.0, 200.0),    # mm en una hora
    "RAD": (0.0, 1500.0),      # W/m²
    "PRES": (600.0, 1100.0),   # hPa
}

# Textos con los que las fuentes indican un dato ausente.
TEXTOS_FALTANTE = {"", "nd", "n/d", "na", "n/a", "-", "--", "sin dato", "null", "none"}

# Nombres de columna del portal de Cali y su codigo comun.
_PATRONES_PARAMETRO = [
    (re.compile(r"^\s*pm\s*2[.,]?5", re.IGNORECASE), "PM25"),
    (re.compile(r"^\s*pm\s*10", re.IGNORECASE), "PM10"),
    (re.compile(r"^\s*o3\b", re.IGNORECASE), "O3"),
    (re.compile(r"^\s*no2\b", re.IGNORECASE), "NO2"),
    (re.compile(r"^\s*so2\b", re.IGNORECASE), "SO2"),
    (re.compile(r"^\s*co\b", re.IGNORECASE), "CO"),
    (re.compile(r"^\s*h2s\b", re.IGNORECASE), "H2S"),
    (re.compile(r"^\s*vel\.?\s*viento", re.IGNORECASE), "VV"),
    (re.compile(r"^\s*dir\.?\s*viento", re.IGNORECASE), "DV"),
    (re.compile(r"^\s*temperatura", re.IGNORECASE), "TEMP"),
    (re.compile(r"^\s*humedad", re.IGNORECASE), "HUM"),
    (re.compile(r"^\s*radiaci", re.IGNORECASE), "RAD"),
    (re.compile(r"^\s*lluvia", re.IGNORECASE), "LLUVIA"),
]

_FORMATOS_ISO = (
    "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
)
# Las fechas con barras son ambiguas (05/06/2019 puede ser 5 de junio o 6 de
# mayo), por eso el orden se declara por recurso y no se adivina.
_FORMATOS_BARRA = {
    "mdy": ("%m/%d/%Y %H:%M", "%m/%d/%Y %H:%M:%S"),
    "dmy": ("%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S"),
}
_PATRON_HORA_24 = re.compile(r"^(.*\D)24:00(:00)?$")


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


def leer_fecha(texto: str, orden: str = "mdy", excel_invertido: bool = False) -> datetime:
    """Interpreta una fecha local de la fuente y la devuelve en UTC (ISO 8601).

    Acepta:
    - fechas ISO;
    - fechas con barras, en el orden declarado para el recurso ("mdy" o "dmy");
    - la hora 24:00, que equivale a las 00:00 del dia siguiente;
    - numeros de serie de Excel, con punto o coma decimal (41646,04167).

    excel_invertido corrige un defecto de algunos archivos del portal de Cali:
    Excel leyo fechas mes/dia como dia/mes cuando el dia era menor o igual a
    12 y las convirtio en numeros de serie con el dia y el mes cambiados.
    """
    limpio = str(texto).strip()
    if _PATRON_SERIE_EXCEL.match(limpio):
        local = _ORIGEN_EXCEL + timedelta(days=float(limpio.replace(",", ".")))
        local = local.replace(second=0, microsecond=0) + timedelta(minutes=round(local.second / 60))
        if excel_invertido:
            local = local.replace(month=local.day, day=local.month)
        return local.replace(tzinfo=ZONA_FUENTES).astimezone(timezone.utc)
    dia_siguiente = False
    if coincidencia := _PATRON_HORA_24.match(limpio):
        limpio = coincidencia.group(1) + "00:00"
        dia_siguiente = True
    for formato in _FORMATOS_ISO + _FORMATOS_BARRA[orden]:
        try:
            local = datetime.strptime(limpio, formato)
        except ValueError:
            continue
        if dia_siguiente:
            local += timedelta(days=1)
        return local.replace(tzinfo=ZONA_FUENTES).astimezone(timezone.utc)
    raise ValueError(f"Formato de fecha no reconocido: {texto!r}")


def candidatos_fecha(texto: str, orden: str = "mdy") -> list[datetime]:
    """Lecturas posibles de una fecha que puede venir con el dia y el mes invertidos.

    Solo los numeros de serie de Excel con dia menor o igual a 12 (y distinto
    del mes) tienen dos lecturas posibles. El conector elige la que encaja con
    la secuencia de la serie.
    """
    lectura = leer_fecha(texto, orden)
    if not _PATRON_SERIE_EXCEL.match(str(texto).strip()):
        return [lectura]
    local = lectura.astimezone(ZONA_FUENTES)
    if local.day > 12 or local.day == local.month:
        return [lectura]
    return [lectura, leer_fecha(texto, orden, excel_invertido=True)]


_PALABRAS_MENORES = {"de", "del", "la", "las", "los", "el", "y"}


def nombre_propio(texto: str) -> str:
    """Pone en mayuscula inicial un nombre que la fuente publica en mayusculas,
    sin capitalizar los articulos y preposiciones (Universidad del Valle)."""
    def capitalizar(palabra):
        return "-".join(s[:1].upper() + s[1:] for s in palabra.split("-"))

    palabras = str(texto).strip().lower().split()
    return " ".join(p if i and p in _PALABRAS_MENORES else capitalizar(p)
                    for i, p in enumerate(palabras))


def bandera(codigo: str, valor: float | None) -> str:
    """Asigna la bandera de calidad de una medicion (RF-03)."""
    if valor is None:
        return "faltante"
    minimo, maximo = RANGOS_FISICOS.get(codigo, (float("-inf"), float("inf")))
    if valor < minimo or valor > maximo:
        return "fuera_de_rango"
    return "valido"
