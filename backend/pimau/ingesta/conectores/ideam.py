"""Conector del conjunto nacional del IDEAM en datos.gov.co (API Socrata).

Conjunto: Calidad del Aire en Colombia (g4t8-zkc3). Se filtran las estaciones
de Santiago de Cali, los registros horarios (duracion de 60 minutos) y las
variables de VARIABLES. El conjunto tambien trae algunos promedios diarios
(duracion de 1440 minutos), que no se mezclan con los horarios.
"""
import dataclasses
import logging
from collections.abc import Iterator
from datetime import datetime
from zoneinfo import ZoneInfo

from pimau.ingesta import normalizacion as norma
from pimau.ingesta.conectores.base import (
    ConectorMediciones,
    EstacionOrigen,
    RegistroMedicion,
    fecha_utc,
    obtener,
)

URL = "https://www.datos.gov.co/resource/g4t8-zkc3.json"
# Metadatos del conjunto: rowsUpdatedAt es la última actualización de los datos
# (procedencia, RF-04).
URL_METADATOS = "https://www.datos.gov.co/api/views/g4t8-zkc3.json"
log = logging.getLogger("pimau.ingesta")
TAMANO_PAGINA = 10000
DURACION_HORARIA = "60"
# El conjunto de Cali empieza en 2020, pero se consulta desde antes por si se
# agregan series historicas.
INICIO_HISTORICO = datetime(2010, 1, 1)


def _mes_siguiente(fecha: datetime) -> datetime:
    return datetime(fecha.year + fecha.month // 12, fecha.month % 12 + 1, 1)

# codigo del IDEAM: (codigo comun, unidades aceptadas, factor de conversion)
VARIABLES = {
    "PM2.5": ("PM25", {"ug/m3"}, 1.0),
    "PM10": ("PM10", {"ug/m3"}, 1.0),
    "O3": ("O3", {"ug/m3"}, 1.0),
    "SO2": ("SO2", {"ug/m3"}, 1.0),
    # Temperatura y humedad a 2 m, la altura estandar. Las de 10 m no se usan.
    "TAire2": ("TEMP", {"°C"}, 1.0),
    "HAire2": ("HUM", {"%"}, 1.0),
    "VViento": ("VV", {"m/s"}, 1.0),
    "DViento": ("DV", {"°"}, 1.0),
    "PLiquida": ("LLUVIA", {"mm"}, 1.0),
    # Wh/m² acumulados en una hora equivalen a W/m² promedio de esa hora.
    "RGlobal": ("RAD", {"Wh/m2"}, 1.0),
    # Presion: de milimetros de mercurio a hectopascales (ver PRESION_YA_EN_HPA).
    "P": ("PRES", {"mmHg"}, 1.333224),
}

# Las estaciones del DAGMA declaran la presion en mmHg, pero en algunos
# periodos publican valores que ya estan en hPa (cerca de 905). En Cali, a unos
# 1000 m de altura, la presion en mmHg ronda 670 y nunca llega a 800, asi que un
# valor de 800 o mas ya esta en hPa y no se convierte (ver bitacora).
PRESION_YA_EN_HPA = 800.0


class ConectorIdeam(ConectorMediciones):

    def _condiciones(self, inicio: datetime, fin: datetime) -> str:
        variables = ",".join(f"'{c}'" for c in VARIABLES)
        return (f"municipio='Santiago de Cali' AND duraci_n='{DURACION_HORARIA}' "
                f"AND msfl_code in({variables}) "
                f"AND med_fecha_final > '{inicio:%Y-%m-%dT%H:%M:%S}' "
                f"AND med_fecha_final <= '{fin:%Y-%m-%dT%H:%M:%S}'")

    def extraer(self, desde: datetime | None) -> Iterator[RegistroMedicion]:
        """Descarga por meses. Paginar todo el historico con desplazamientos
        grandes se vuelve muy lento en datos.gov.co (ver bitacora), y una
        consulta por mes se mantiene pequena y rapida."""
        zona = ZoneInfo("America/Bogota")
        self.fecha_publicacion = self._fecha_publicacion()
        inicio = desde.astimezone(zona).replace(tzinfo=None) if desde else INICIO_HISTORICO
        limite = datetime.now(zona).replace(tzinfo=None)
        while inicio < limite:
            fin = _mes_siguiente(inicio)
            yield from self._extraer_ventana(inicio, fin)
            inicio = fin

    def _extraer_ventana(self, inicio: datetime, fin: datetime) -> Iterator[RegistroMedicion]:
        desplazamiento = 0
        while True:
            respuesta = obtener(self.cliente, URL, params={
                "$where": self._condiciones(inicio, fin),
                "$order": "med_fecha_final, estacion_id, msfl_code",
                "$limit": TAMANO_PAGINA,
                "$offset": desplazamiento,
            })
            filas = respuesta.json()
            for fila in filas:
                registro = self._normalizar(fila)
                if registro is not None:
                    yield dataclasses.replace(registro, fecha_publicacion=self.fecha_publicacion)
            if len(filas) < TAMANO_PAGINA:
                return
            desplazamiento += TAMANO_PAGINA

    def _fecha_publicacion(self) -> datetime | None:
        """Fecha de la última actualización del conjunto. Si no se puede leer,
        la ingesta sigue y la medición queda sin fecha de publicación."""
        try:
            return fecha_utc(obtener(self.cliente, URL_METADATOS).json().get("rowsUpdatedAt"))
        except Exception:
            log.warning("No se pudo leer la fecha de publicación del IDEAM", exc_info=True)
            return None

    @staticmethod
    def _normalizar(fila: dict) -> RegistroMedicion | None:
        variable = VARIABLES.get(fila.get("msfl_code", ""))
        if variable is None or fila.get("duraci_n", DURACION_HORARIA) != DURACION_HORARIA:
            return None
        codigo, unidades, factor = variable
        if fila.get("sigla_unidad") not in unidades:
            raise ValueError(f"Unidad inesperada para {codigo}: {fila.get('sigla_unidad')}")
        estacion = EstacionOrigen(
            codigo=str(fila["estacion_id"]),
            nombre=norma.nombre_propio(fila["nombre_est"]),
            latitud=float(fila["latitud"]),
            longitud=float(fila["longitud"]),
        )
        valor = norma.leer_numero(fila.get("med_concentracion_estandar"))
        if valor is not None and not (codigo == "PRES" and valor >= PRESION_YA_EN_HPA):
            valor = round(valor * factor, 4)
        # El instante de la medicion es el final del periodo de promediacion.
        return RegistroMedicion(
            estacion=estacion,
            parametro=codigo,
            instante=norma.leer_fecha(fila["med_fecha_final"]),
            valor=valor,
            bandera=norma.bandera(codigo, valor),
        )
