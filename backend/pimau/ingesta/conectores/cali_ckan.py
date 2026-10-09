"""Conector del portal de Datos Abiertos de Cali (API CKAN, datastore).

Cada estacion del DAGMA se publica como un recurso con una columna por
contaminante. Los nombres de columna, el formato de fecha y la forma de
marcar los faltantes ("ND") cambian entre recursos, y por eso este conector
es el ejemplo mas claro de la normalizacion (RF-02).

Las coordenadas vienen de la capa dagma:obs_aire_estaciones_monitoreo de la
IDESC, consultada el 2026-10-09.
"""
from datetime import datetime
from typing import Iterator

from pimau.ingesta import normalizacion as norma
from pimau.ingesta.conectores.base import (ConectorMediciones, EstacionOrigen,
                                           RegistroMedicion, obtener)

URL = "https://datos.cali.gov.co/api/3/action/datastore_search"
TAMANO_PAGINA = 20000
COLUMNA_FECHA = "Fecha & Hora"

# codigo, nombre, latitud, longitud, recurso CKAN
ESTACIONES = [
    ("CA", "Cañaveralejo", 3.41545841, -76.54961789, "b96b2baa-1f03-4f6a-ad7a-6b76ffb1e400"),
    ("PA", "Pance", 3.30449556, -76.53125401, "6a0b0d95-a57d-48dd-b85e-43939aeb5d40"),
    ("CO", "Compartir", 3.42825808, -76.46657547, "34e0f68a-d488-4c83-8782-42a3d0126540"),
    ("UV", "Universidad del Valle", 3.37796681, -76.53372474, "4bb8d25c-e07e-4ac7-9630-b0cf067410f6"),
    ("ET", "Transitoria EDB Navarro", 3.41717874, -76.49495633, "2a70f546-aa49-47d6-a4b5-2f3a5f2271e0"),
    ("ER", "La Ermita", 3.45551754, -76.53097834, "1ec66594-77a9-44e5-9ab4-251f208300de"),
    ("FLO", "La Flora", 3.48822548, -76.51805771, "a83fcd9d-fd8e-44b1-96b4-102ed9c7326b"),
    ("ERA", "ERA - Obrero", 3.4475941, -76.51908184, "ad903512-8847-4f42-b04f-4ae590ed8766"),
    # Base Aerea (6ab2160a-2bee-478b-aef2-d56887610513) no esta en el datastore
    # del portal; solo se publica como archivo. Ver docs/bitacora.md.
]


class ConectorCaliCkan(ConectorMediciones):

    def extraer(self, desde: datetime | None) -> Iterator[RegistroMedicion]:
        for codigo, nombre, latitud, longitud, recurso in ESTACIONES:
            estacion = EstacionOrigen(codigo, nombre, latitud, longitud)
            yield from self._extraer_recurso(estacion, recurso, desde)

    def _extraer_recurso(self, estacion, recurso, desde) -> Iterator[RegistroMedicion]:
        desplazamiento = 0
        while True:
            respuesta = obtener(self.cliente, URL, params={
                "resource_id": recurso, "limit": TAMANO_PAGINA,
                "offset": desplazamiento, "sort": "_id",
            })
            resultado = respuesta.json()["result"]
            columnas = {c["id"]: norma.codigo_parametro(c["id"]) for c in resultado["fields"]}
            for fila in resultado["records"]:
                try:
                    instante = norma.leer_fecha(fila[COLUMNA_FECHA])
                except ValueError:
                    self.filas_descartadas += 1
                    continue
                if desde is not None and instante <= desde:
                    continue
                for columna, codigo in columnas.items():
                    if codigo is None:
                        continue
                    valor = norma.leer_numero(fila.get(columna))
                    yield RegistroMedicion(estacion=estacion, parametro=codigo,
                                           instante=instante, valor=valor,
                                           bandera=norma.bandera(codigo, valor))
            desplazamiento += len(resultado["records"])
            if not resultado["records"] or desplazamiento >= resultado["total"]:
                return
