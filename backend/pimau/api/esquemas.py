"""Esquemas de respuesta de la API (Pydantic).

FastAPI valida cada respuesta contra estos esquemas antes de enviarla y los
publica en la documentación OpenAPI (RF-08). Así la entrada y la salida de la
API quedan tipadas, como pide la sección de Construcción del Capítulo 3.

Los instantes se dejan como texto ISO 8601 en UTC, tal como los entrega la
base de datos, para no cambiar el formato que ya usa el visor.
"""
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field


class Salud(BaseModel):
    estado: Literal["ok"]


class Parametro(BaseModel):
    codigo: str = Field(description="Código normalizado, por ejemplo PM25")
    nombre: str
    unidad: str
    variable: str = Field(description="Grupo: calidad_aire, meteorologia o ruido")
    con_datos: bool = Field(description="Si hay al menos una medición con valor")
    ventana_ica_horas: int | None = Field(description="Horas del promedio con que se calcula el ICA. "
                                                      "Nulo si la variable no tiene ICA")


class CategoriaIca(BaseModel):
    categoria: str
    inferior: float | None
    superior: float | None
    color: str | None


class UmbralesParametro(BaseModel):
    ica: list[CategoriaIca] = Field(description="Puntos de corte de la Resolución 2254 de 2017")
    oms: dict[str, float] = Field(description="Valores guía de la OMS 2021 por periodo")


class GuiaOms(BaseModel):
    periodo: str
    valor: float
    comparable: bool = Field(description="Si el periodo de la guía coincide con el del ICA")


class EstadoParametro(BaseModel):
    instante: str | None = Field(description="Último valor válido, ISO 8601 en UTC")
    valor_horario: float | None
    ventana_ica_horas: int | None
    instante_ica: str | None
    promedio_ica: float | None
    horas_validas_ica: int | None
    ica: int | None
    categoria: str | None
    color: str | None
    guia_oms: GuiaOms | None


class PropiedadesEstacion(BaseModel):
    id: int
    nombre: str
    codigo: str
    fuente: str
    parametros: dict[str, EstadoParametro]


class Punto(BaseModel):
    type: Literal["Point"]
    coordinates: list[float]


class EstacionGeo(BaseModel):
    type: Literal["Feature"]
    geometry: Punto
    properties: PropiedadesEstacion


class ColeccionEstaciones(BaseModel):
    type: Literal["FeatureCollection"]
    features: list[EstacionGeo]


class Rango(BaseModel):
    desde: date
    hasta: date


class EstacionResumen(BaseModel):
    id: int
    nombre: str
    fuente: str


class PuntoHorario(BaseModel):
    instante: str = Field(description="ISO 8601 en UTC")
    valor: float | None
    bandera: str = Field(description="valido, faltante o fuera_de_rango")


class PuntoDiario(BaseModel):
    dia: date
    valor: float | None
    horas_validas: int
    bandera: str


class Serie(BaseModel):
    estacion: EstacionResumen
    parametro: str
    agregacion: Literal["hora", "dia"]
    datos: list[PuntoHorario] | list[PuntoDiario]


class PropiedadesCapa(BaseModel):
    codigo: str
    nombre: str
    tipo: str


class Geometria(BaseModel):
    type: str
    # Las coordenadas de polígonos se anidan en varios niveles y no se
    # validan una por una, para no frenar la respuesta de capas grandes.
    coordinates: list[Any]


class ElementoCapa(BaseModel):
    type: Literal["Feature"]
    geometry: Geometria
    properties: PropiedadesCapa


class Capa(BaseModel):
    type: Literal["FeatureCollection"]
    features: list[ElementoCapa]
