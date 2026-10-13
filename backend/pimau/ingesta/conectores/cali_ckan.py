"""Conector del portal de Datos Abiertos de Cali (API CKAN).

Cada estacion del DAGMA se publica como un recurso con una columna por
contaminante. Los nombres de columna, el formato de fecha y la forma de
marcar los faltantes ("ND") cambian entre recursos, y por eso este conector
es el ejemplo mas claro de la normalizacion (RF-02). Las particularidades de
cada recurso se declaran en ESTACIONES y estan documentadas en la bitacora.

La mayoria de los recursos se lee del datastore de CKAN. Base Aerea solo se
publica como archivo CSV y se descarga completo.

Las coordenadas vienen de la capa dagma:obs_aire_estaciones_monitoreo de la
IDESC, consultada el 2026-10-09.
"""
import csv
import io
import logging
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta

from pimau.ingesta import normalizacion as norma
from pimau.ingesta.conectores.base import (
    ConectorMediciones,
    EstacionOrigen,
    RegistroMedicion,
    fecha_utc,
    obtener,
)

URL = "https://datos.cali.gov.co/api/3/action/datastore_search"
URL_RECURSO = "https://datos.cali.gov.co/api/3/action/resource_show"
TAMANO_PAGINA = 20000
COLUMNA_FECHA = "Fecha & Hora"
log = logging.getLogger("pimau.ingesta")


@dataclass(frozen=True)
class RecursoEstacion:
    codigo: str
    nombre: str
    latitud: float
    longitud: float
    recurso: str
    # "datastore" o "csv"
    acceso: str = "datastore"
    # Orden de las fechas con barras: "mdy" o "dmy".
    orden_fecha: str = "mdy"
    # True si algunas fechas de Excel del recurso tienen el dia y el mes
    # invertidos. Cada fecha ambigua se resuelve con la secuencia de la serie.
    excel_ambiguo: bool = False


ESTACIONES = [
    # Cañaveralejo y La Ermita: entre 2014 y 2018, las fechas con dia <= 12
    # quedaron como numeros de serie de Excel con el dia y el mes invertidos.
    # Desde 2019 los numeros de serie son correctos (ver bitacora).
    RecursoEstacion("CA", "Cañaveralejo", 3.41545841, -76.54961789,
                    "b96b2baa-1f03-4f6a-ad7a-6b76ffb1e400", excel_ambiguo=True),
    RecursoEstacion("PA", "Pance", 3.30449556, -76.53125401, "6a0b0d95-a57d-48dd-b85e-43939aeb5d40"),
    RecursoEstacion("CO", "Compartir", 3.42825808, -76.46657547, "34e0f68a-d488-4c83-8782-42a3d0126540"),
    RecursoEstacion("UV", "Universidad del Valle", 3.37796681, -76.53372474,
                    "4bb8d25c-e07e-4ac7-9630-b0cf067410f6"),
    RecursoEstacion("ET", "Transitoria EDB Navarro", 3.41717874, -76.49495633,
                    "2a70f546-aa49-47d6-a4b5-2f3a5f2271e0"),
    RecursoEstacion("ER", "La Ermita", 3.45551754, -76.53097834,
                    "1ec66594-77a9-44e5-9ab4-251f208300de", excel_ambiguo=True),
    RecursoEstacion("FLO", "La Flora", 3.48822548, -76.51805771, "a83fcd9d-fd8e-44b1-96b4-102ed9c7326b"),
    RecursoEstacion("ERA", "ERA - Obrero", 3.4475941, -76.51908184, "ad903512-8847-4f42-b04f-4ae590ed8766"),
    # Base Aerea: no esta en el datastore. El CSV usa ";" y, en 2019, fechas
    # dia/mes/ano con la hora 24:00.
    RecursoEstacion("BA", "Base Aérea", 3.45731978, -76.50653649,
                    "6ab2160a-2bee-478b-aef2-d56887610513", acceso="csv", orden_fecha="dmy"),
]


class ConectorCaliCkan(ConectorMediciones):

    def extraer(self, desde: datetime | None) -> Iterator[RegistroMedicion]:
        for recurso in ESTACIONES:
            estacion = EstacionOrigen(recurso.codigo, recurso.nombre, recurso.latitud, recurso.longitud)
            metadatos = self._metadatos(recurso)
            publicacion = fecha_utc(metadatos.get("last_modified") or metadatos.get("created"))
            filas = (self._filas_csv(metadatos) if recurso.acceso == "csv"
                     else self._filas_datastore(recurso))
            yield from self._normalizar(estacion, recurso, filas, desde, publicacion)

    def _metadatos(self, recurso: RecursoEstacion) -> dict:
        """Metadatos del recurso en CKAN: la URL del archivo y la fecha de su
        última actualización, que se guarda como fecha de publicación (RF-04)."""
        try:
            return obtener(self.cliente, URL_RECURSO, params={"id": recurso.recurso}).json()["result"]
        except Exception:
            if recurso.acceso == "csv":
                raise
            log.warning("No se pudieron leer los metadatos de %s", recurso.nombre, exc_info=True)
            return {}

    def _filas_datastore(self, recurso: RecursoEstacion) -> Iterator[dict]:
        desplazamiento = 0
        while True:
            respuesta = obtener(self.cliente, URL, params={
                "resource_id": recurso.recurso, "limit": TAMANO_PAGINA,
                "offset": desplazamiento, "sort": "_id",
            })
            resultado = respuesta.json()["result"]
            yield from resultado["records"]
            desplazamiento += len(resultado["records"])
            if not resultado["records"] or desplazamiento >= resultado["total"]:
                return

    def _filas_csv(self, metadatos: dict) -> Iterator[dict]:
        contenido = obtener(self.cliente, metadatos["url"]).content.decode("utf-8-sig")
        separador = csv.Sniffer().sniff(contenido[:2000], delimiters=";,").delimiter
        yield from csv.DictReader(io.StringIO(contenido), delimiter=separador)

    def _normalizar(self, estacion: EstacionOrigen, recurso: RecursoEstacion,
                    filas: Iterable[dict], desde: datetime | None,
                    publicacion: datetime | None = None) -> Iterator[RegistroMedicion]:
        columnas = None
        anterior = None
        for fila in filas:
            if columnas is None:
                columnas = {c: norma.codigo_parametro(c) for c in fila if c != COLUMNA_FECHA}
            try:
                instante = self._leer_instante(fila[COLUMNA_FECHA], recurso, anterior)
            except ValueError:
                self.filas_descartadas += 1
                continue
            anterior = instante
            if desde is not None and instante <= desde:
                continue
            for columna, codigo in columnas.items():
                if codigo is None:
                    continue
                valor = norma.leer_numero(fila.get(columna))
                yield RegistroMedicion(estacion=estacion, parametro=codigo,
                                       instante=instante, valor=valor,
                                       bandera=norma.bandera(codigo, valor),
                                       fecha_publicacion=publicacion)

    @staticmethod
    def _leer_instante(texto, recurso: RecursoEstacion, anterior: datetime | None) -> datetime:
        if not recurso.excel_ambiguo:
            return norma.leer_fecha(texto, orden=recurso.orden_fecha)
        candidatos = norma.candidatos_fecha(texto, orden=recurso.orden_fecha)
        if len(candidatos) == 1 or anterior is None:
            return candidatos[0]
        # La serie es horaria y esta ordenada: se elige la lectura mas cercana
        # a una hora despues de la fila anterior.
        esperado = anterior + timedelta(hours=1)
        return min(candidatos, key=lambda c: abs(c - esperado))
