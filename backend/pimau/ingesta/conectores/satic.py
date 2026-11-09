"""Conector de SATIC (red del Observatorio Ambiental de la Comuna 22, OAC22).

SATIC (https://satic.cali.gov.co), el geoportal de la Alcaldía de Cali, no
ofrece una API pública, pero deja descargar los últimos 30 días de cada
variable de cada estación como un archivo Excel. El administrador deja esos
archivos en la bandeja de entrada (configuracion.satic_bandeja) y este
conector los lee. Es la única fuente verificada con datos recientes de Cali.

Lo que se encontró al revisar los archivos (docs/bitacora.md, 2026-10-21):
- La columna de unidad está errada (dice "CC", cédula de ciudadanía), así que
  la unidad no se lee del archivo: se asigna por variable, con el parámetro.
- Los umbrales de color del archivo no son los del ICA de la Resolución 2254.
  PIMAU calcula el ICA con la norma, igual que para las demás fuentes.
- El sensor de PM de la Universidad Javeriana marco 0 durante todo el mes. Las
  rachas de un mismo valor se marcan como sospechosas (normalizacion.py).
- Los sensores son de bajo costo: su PM10 es casi igual a su PM2.5, cuando el
  PM10 real incluye al PM2.5 y suele ser bastante mayor. El visor lo advierte.
- SATIC guarda la hora de Colombia como si fuera UTC y la muestra en la zona del
  navegador, asi que en un archivo bajado en hora de Colombia la hora es la UTC
  real (configuracion.satic_zona_horaria). Una lectura que quede en el futuro
  indica que eso cambio: se descarta y se advierte.
- Las mediciones llegan cada 15 a 30 minutos. Se agregan a promedios horarios
  para que sean comparables con las demás fuentes. Cada promedio se fecha al
  final de su hora, como la fecha final del IDEAM. La primera y la última hora
  de cada descarga pueden quedar a medias, así que no se guardan: llegan
  completas en otra descarga, porque las ventanas de 30 días se solapan.
"""
import json
import logging
import math
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from openpyxl import load_workbook

from pimau.config import configuracion
from pimau.ingesta import normalizacion as norma
from pimau.ingesta.conectores.base import ConectorMediciones, EstacionOrigen, RegistroMedicion

log = logging.getLogger("pimau.ingesta")

HORA = timedelta(hours=1)
# Si la ultima descarga correcta es mas vieja que esto, la ejecucion lo advierte.
HORAS_SIN_DESCARGA = 3
ARCHIVO_ESTADO = "_estado_descarga.json"  # lo escribe descarga_satic.py
# Margen para el reloj de los sensores antes de considerar que una lectura esta en el futuro.
TOLERANCIA_FUTURO = timedelta(minutes=20)

# Variable de SATIC y su código en el modelo común. La unidad del archivo no es
# confiable, así que la da el parámetro (el ruido, en dB(A)).
VARIABLES = {
    "PM25_AVG": "PM25",
    "PM10_AVG": "PM10",
    "TEMP_AVG": "TEMP",
    "HUM_AVG": "HUM",
    "WDIR_AVG": "DV",
    "NOISE_AVG": "RUIDO",
}


@dataclass(frozen=True)
class EstacionSatic:
    nombre: str
    latitud: float
    longitud: float


# Código corto que usa el archivo ("PM25_AVG - USB") y la estación del
# geoportal. Nombres y coordenadas tomados del mapa de SATIC el 2026-10-21.
# Ecoparque Corazón de Pance y Ecoparque Las Garzas no tenían datos en los 30
# días anteriores, así que no se conoce su código: si aparecen en un archivo,
# sus filas se descartan con una advertencia hasta agregarlas aquí.
ESTACIONES = {
    "SAN MARTIN": EstacionSatic("Fundación Universitaria San Martín", 3.34312, -76.52165),
    "BAGATELLE": EstacionSatic("Condominio Bagatelle", 3.36303, -76.54121),
    "FVL": EstacionSatic("Fundación Valle del Lili", 3.3728, -76.52588),
    "USB": EstacionSatic("Universidad San Buenaventura", 3.34475, -76.54399),
    "ICESI": EstacionSatic("Universidad ICESI", 3.34225, -76.52983),
    "UAO": EstacionSatic("Universidad Autónoma de Occidente", 3.35386, -76.52274),
    "JAVERIANA": EstacionSatic("Universidad Javeriana", 3.34897, -76.53147),
    "LIBRE": EstacionSatic("Universidad Libre", 3.36104, -76.52656),
    "NEW CAMBRIDGE": EstacionSatic("Colegio Nuevo Cambridge", 3.33808, -76.53882),
    "CAMPESTRE": EstacionSatic("Club Campestre Cali", 3.36894, -76.54593),
    "CATOLICA": EstacionSatic("Universidad Católica Meléndez", 3.37535, -76.54539),
    "HOLGUINES": EstacionSatic("Holguines Trade Center", 3.37221, -76.5392),
    "USC": EstacionSatic("Universidad Santiago de Cali", 3.40404, -76.54861),
    "ROSARIO": EstacionSatic("Colegio Nuestra Señora del Rosario", 3.3391, -76.5278),
}

COLUMNA_SENSOR = "nom_sensor"
COLUMNA_VARIABLE = "nom_corto"
COLUMNA_VALOR = "dato_sensor"
COLUMNA_FECHA = "fecha_registro_dato_sensor"


def promedio(codigo: str, valores: list[float]) -> float:
    """Promedio horario. La dirección del viento es un ángulo, así que se
    promedia como vector (el promedio de 350° y 10° es 0°, no 180°). El ruido
    está en decibeles, una escala logarítmica, así que se promedia la energía
    (nivel equivalente): 50 y 70 dB dan 67 dB, no 60."""
    if codigo == "DV":
        seno = sum(math.sin(math.radians(v)) for v in valores)
        coseno = sum(math.cos(math.radians(v)) for v in valores)
        return round(math.degrees(math.atan2(seno, coseno)) % 360, 4)
    if codigo == "RUIDO":
        energia = sum(10 ** (v / 10) for v in valores) / len(valores)
        return round(10 * math.log10(energia), 4)
    return round(sum(valores) / len(valores), 4)


class ConectorSatic(ConectorMediciones):

    def __init__(self, cliente=None, bandeja: str | Path | None = None, ahora: datetime | None = None):
        super().__init__(cliente)
        self.bandeja = Path(bandeja or configuracion.satic_bandeja)
        self.zona = ZoneInfo(configuracion.satic_zona_horaria)
        self.ahora = ahora

    def _revisar_descarga(self):
        """Advierte si la descarga automatica de SATIC lleva horas fallando."""
        try:
            estado = json.loads((self.bandeja / ARCHIVO_ESTADO).read_text())
        except (OSError, ValueError):
            return
        ahora = self.ahora or datetime.now(UTC)
        exito = estado.get("ultimo_exito")
        if exito and ahora - datetime.fromisoformat(exito) < timedelta(hours=HORAS_SIN_DESCARGA):
            return
        desde = (f"desde el {datetime.fromisoformat(exito):%Y-%m-%d %H:%M} UTC" if exito
                 else "sin ninguna descarga correcta")
        if estado.get("error"):
            self.advertencias.append(f"Advertencia: la descarga automática de SATIC falla {desde} "
                                     f"({estado['error']})")
        else:
            # Sin error registrado, la descarga no falló: no ha vuelto a correr
            # (por ejemplo, el servicio estuvo apagado). Decir «falla» confundía.
            self.advertencias.append(f"Advertencia: no hay descargas nuevas de SATIC {desde}; "
                                     "el descargador no ha vuelto a correr o está apagado")

    def extraer(self, desde: datetime | None) -> Iterator[RegistroMedicion]:
        self._revisar_descarga()
        # Se leen todos los archivos en cada ejecución: guardar una hora que ya
        # existe no la duplica, y así una descarga atrasada también se carga.
        archivos = sorted(self.bandeja.glob("*.xlsx")) if self.bandeja.is_dir() else []
        if not archivos:
            log.info("SATIC: no hay archivos en %s", self.bandeja)
        for archivo in archivos:
            yield from self._leer_archivo(archivo)

    def _leer_archivo(self, archivo: Path) -> Iterator[RegistroMedicion]:
        libro = load_workbook(archivo, read_only=True, data_only=True)
        filas = libro.active.iter_rows(values_only=True)
        encabezado = [str(c).strip() if c is not None else "" for c in next(filas, [])]
        if not {COLUMNA_SENSOR, COLUMNA_VARIABLE, COLUMNA_VALOR, COLUMNA_FECHA} <= set(encabezado):
            raise ValueError(f"{archivo.name} no tiene las columnas esperadas de SATIC: {encabezado}")
        posicion = {nombre: i for i, nombre in enumerate(encabezado)}

        # Lecturas válidas por estación, parámetro y hora.
        lecturas: dict[tuple[str, str], dict[datetime, list[float]]] = defaultdict(lambda: defaultdict(list))
        limite = (self.ahora or datetime.now(UTC)) + TOLERANCIA_FUTURO
        en_el_futuro = 0
        for fila in filas:
            sensor = str(fila[posicion[COLUMNA_SENSOR]] or "")
            codigo_estacion = sensor.split(" - ", 1)[1].strip() if " - " in sensor else ""
            codigo = VARIABLES.get(str(fila[posicion[COLUMNA_VARIABLE]] or "").strip())
            if codigo is None:
                continue
            if codigo_estacion not in ESTACIONES:
                self.filas_descartadas += 1
                continue
            try:
                instante = norma.leer_fecha(str(fila[posicion[COLUMNA_FECHA]]), orden="dmy", zona=self.zona)
            except ValueError:
                self.filas_descartadas += 1
                continue
            if instante > limite:
                en_el_futuro += 1
                self.filas_descartadas += 1
                continue
            valor = norma.leer_numero(fila[posicion[COLUMNA_VALOR]])
            if valor is None:
                continue
            # La lectura de las 10:20 pertenece a la hora que termina a las 11:00.
            fin_hora = instante.replace(minute=0, second=0, microsecond=0)
            if fin_hora != instante:
                fin_hora += HORA
            lecturas[(codigo_estacion, codigo)][fin_hora].append(valor)
        libro.close()
        if en_el_futuro:
            log.warning("SATIC: %s lecturas de %s quedan en el futuro; revise satic_zona_horaria",
                        en_el_futuro, archivo.name)

        for (codigo_estacion, codigo), horas in lecturas.items():
            datos = ESTACIONES[codigo_estacion]
            estacion = EstacionOrigen(f"OAC22-{codigo_estacion}", datos.nombre, datos.latitud, datos.longitud)
            # La primera y la última hora de la descarga pueden estar a medias:
            # no se guardan, porque una hora guardada ya no se reemplaza.
            primera = min(horas)
            ultima = max(horas)
            promedios = {fin_hora: promedio(codigo, valores) for fin_hora, valores in horas.items()}
            # Un sensor detenido repite el mismo valor: esas horas quedan como sospechosas.
            constantes = norma.horas_constantes(codigo, promedios)
            for fin_hora, valor in sorted(promedios.items()):
                if fin_hora in (primera, ultima):
                    continue
                bandera = norma.bandera(codigo, valor)
                if bandera == "valido" and fin_hora in constantes:
                    bandera = "sospechoso"
                yield RegistroMedicion(estacion=estacion, parametro=codigo, instante=fin_hora,
                                       valor=valor, bandera=bandera)
