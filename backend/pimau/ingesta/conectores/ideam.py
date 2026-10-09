"""Conector del conjunto nacional del IDEAM en datos.gov.co (API Socrata).

Conjunto: Calidad del Aire en Colombia (g4t8-zkc3). Se filtran las estaciones
de Santiago de Cali y los parametros PM2.5 y PM10.
"""
from datetime import datetime
from typing import Iterator
from zoneinfo import ZoneInfo

from pimau.ingesta import normalizacion as norma
from pimau.ingesta.conectores.base import (ConectorMediciones, EstacionOrigen,
                                           RegistroMedicion, obtener)

URL = "https://www.datos.gov.co/resource/g4t8-zkc3.json"
TAMANO_PAGINA = 10000
CODIGOS_ORIGEN = ("PM2.5", "PM10")


class ConectorIdeam(ConectorMediciones):

    def _consulta(self, desde: datetime | None) -> str:
        condiciones = ["municipio='Santiago de Cali'",
                       "msfl_code in(" + ",".join(f"'{c}'" for c in CODIGOS_ORIGEN) + ")"]
        if desde is not None:
            local = desde.astimezone(ZoneInfo("America/Bogota")).strftime("%Y-%m-%dT%H:%M:%S")
            condiciones.append(f"med_fecha_final > '{local}'")
        return " AND ".join(condiciones)

    def extraer(self, desde: datetime | None) -> Iterator[RegistroMedicion]:
        desplazamiento = 0
        while True:
            respuesta = obtener(self.cliente, URL, params={
                "$where": self._consulta(desde),
                "$order": "med_fecha_final, estacion_id, msfl_code",
                "$limit": TAMANO_PAGINA,
                "$offset": desplazamiento,
            })
            filas = respuesta.json()
            for fila in filas:
                registro = self._normalizar(fila)
                if registro is not None:
                    yield registro
            if len(filas) < TAMANO_PAGINA:
                return
            desplazamiento += TAMANO_PAGINA

    @staticmethod
    def _normalizar(fila: dict) -> RegistroMedicion | None:
        codigo = norma.codigo_parametro(fila.get("msfl_code", ""))
        if codigo is None:
            return None
        if fila.get("sigla_unidad") not in (None, "ug/m3", "µg/m3", "µg/m³"):
            raise ValueError(f"Unidad inesperada para {codigo}: {fila.get('sigla_unidad')}")
        estacion = EstacionOrigen(
            codigo=str(fila["estacion_id"]),
            nombre=fila["nombre_est"].strip().title(),
            latitud=float(fila["latitud"]),
            longitud=float(fila["longitud"]),
        )
        valor = norma.leer_numero(fila.get("med_concentracion_estandar"))
        # El instante de la medicion es el final del periodo de promediacion.
        return RegistroMedicion(
            estacion=estacion,
            parametro=codigo,
            instante=norma.leer_fecha(fila["med_fecha_final"]),
            valor=valor,
            bandera=norma.bandera(codigo, valor),
        )
