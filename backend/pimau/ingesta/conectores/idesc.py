"""Conector de capas territoriales de la IDESC (servicio OGC WFS).

Las capas se publican en EPSG:6249 (MAGNA-SIRGAS, origen Cali). Se piden en
EPSG:4326 para que GeoServer haga la transformacion, y el conector verifica
que la respuesta llegue en ese sistema.
"""
from dataclasses import dataclass

from shapely.geometry import MultiPolygon, shape

from pimau.ingesta.conectores.base import ConectorCapas, obtener

URL = "https://ws-idesc.cali.gov.co/geoserver/wfs"
CRS_ESPERADO = "urn:ogc:def:crs:EPSG::4326"

# tipo, capa WFS, campo de codigo, campo de nombre
CAPAS = [
    ("comuna", "dapm:pdt_dpa_comunas", "comcodigo", "comnombre"),
    ("barrio", "dapm:pdt_dpa_barrios_sectores", "barcodigo", "barnombre"),
]


@dataclass(frozen=True)
class RegistroCapa:
    tipo: str
    codigo: str
    nombre: str
    geometria_wkt: str


class ConectorIdesc(ConectorCapas):

    def extraer(self):
        for tipo, capa, campo_codigo, campo_nombre in CAPAS:
            respuesta = obtener(self.cliente, URL, params={
                "service": "WFS", "version": "2.0.0", "request": "GetFeature",
                "typeNames": capa, "outputFormat": "application/json",
                "srsName": "EPSG:4326",
            })
            datos = respuesta.json()
            crs = datos.get("crs", {}).get("properties", {}).get("name")
            if crs != CRS_ESPERADO:
                raise ValueError(f"La capa {capa} llegó en {crs}, se esperaba EPSG:4326")
            for elemento in datos["features"]:
                geometria = shape(elemento["geometry"])
                if geometria.geom_type == "Polygon":
                    geometria = MultiPolygon([geometria])
                propiedades = elemento["properties"]
                yield RegistroCapa(tipo=tipo, codigo=str(propiedades[campo_codigo]),
                                   nombre=str(propiedades[campo_nombre]).strip(),
                                   geometria_wkt=geometria.wkt)
