"""Calculo del Indice de Calidad del Aire (Resolucion 2254 de 2017).

Articulo 21: el ICA se obtiene interpolando entre los puntos de corte de la
Tabla 6, con los rangos del indice de la Tabla 5. El paragrafo 3 indica que,
para el reporte en tiempo real, se usa el promedio movil del tiempo de
exposicion del contaminante, que para PM2.5 y PM10 es de 24 horas.

Decision del proyecto (bitacora, 2026-10-09): los puntos de corte de PM2.5 y
PM10 son enteros, asi que la concentracion se trunca al entero antes de
clasificarla. Asi un valor como 12,5 queda en "Buena" (0-12) y no cae en el
vacio entre 12 y 13.
"""
import math
from dataclasses import dataclass

# Rangos del indice por categoria (Tabla 5), en el mismo orden que la Tabla 6.
RANGOS_INDICE = [(0, 50), (51, 100), (101, 150), (151, 200), (201, 300), (301, 500)]

# Tiempo de exposicion de cada contaminante en la Tabla 6, en horas. El ICA se
# calcula con el promedio movil de ese tiempo (articulo 21, paragrafo 3).
VENTANAS_HORAS = {"PM25": 24, "PM10": 24, "CO": 8, "O3": 8, "SO2": 1, "NO2": 1}

# Contaminantes cuya escala no cubre la categoria mas alta en su ventana. Para
# el ozono de 8 horas la norma pide usar el de 1 hora por encima de 393 µg/m³.
SIN_CATEGORIA_SUPERIOR = {"O3"}

# Porcentaje minimo de horas validas para que un promedio sea representativo.
# Es una decision del proyecto (75 %), configurable.
PORCENTAJE_MINIMO = 0.75
MINIMO_HORAS_VALIDAS_24H = math.ceil(24 * PORCENTAJE_MINIMO)


def minimo_horas(codigo: str) -> int:
    return math.ceil(VENTANAS_HORAS[codigo] * PORCENTAJE_MINIMO)


@dataclass(frozen=True)
class PuntoCorte:
    categoria: str
    inferior: float
    superior: float
    color: str | None


@dataclass(frozen=True)
class ResultadoIca:
    valor: int
    categoria: str
    color: str | None


def calcular(concentracion: float | None, cortes: list[PuntoCorte],
             sin_categoria_superior: bool = False) -> ResultadoIca | None:
    """Devuelve el ICA de una concentracion promediada en el tiempo de exposicion
    del contaminante, o None si no aplica."""
    if concentracion is None or concentracion < 0 or not cortes:
        return None
    ordenados = sorted(cortes, key=lambda c: c.inferior)
    c = math.floor(concentracion)
    for corte, (i_bajo, i_alto) in zip(ordenados, RANGOS_INDICE):
        if corte.inferior <= c <= corte.superior:
            pendiente = (i_alto - i_bajo) / (corte.superior - corte.inferior)
            indice = round(pendiente * (c - corte.inferior) + i_bajo)
            return ResultadoIca(indice, corte.categoria, corte.color)
    if sin_categoria_superior:
        return None
    # Por encima del ultimo punto de corte se reporta la categoria mas alta.
    ultimo = ordenados[-1]
    return ResultadoIca(500, ultimo.categoria, ultimo.color)
