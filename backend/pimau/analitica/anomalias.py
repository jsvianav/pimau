"""Deteccion de anomalias con Isolation Forest (RF-13; Capitulo 2, seccion 2.1.8).

Isolation Forest aisla los datos raros con menos particiones aleatorias que los
normales y no necesita ejemplos etiquetados, que ninguna fuente publica. Cada
medicion horaria se describe con cuatro caracteristicas, para encontrar las
anomalias puntuales y las contextuales:

- el valor;
- la hora del dia, como seno y coseno (las 23 y las 0 quedan cerca), para que un
  valor normal a mediodia pueda ser raro a las tres de la manana;
- el cambio respecto a la hora anterior, para los saltos bruscos;
- la diferencia con la mediana de las 24 horas anteriores, para los valores que
  se apartan del nivel reciente de la serie.

Las anomalias colectivas de un sensor detenido ya las marca la ingesta con la
bandera sospechoso, asi que aqui solo se usan las mediciones validas.
"""
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import StandardScaler

METODO = "Isolation Forest"
# Umbral del puntaje de anomalia (score_samples cambiado de signo, entre 0 y 1;
# por debajo de 0,5 los autores consideran normal un dato). Se eligio con
# anomalias insertadas en cinco series sinteticas de 60 dias, cada una con 20
# picos y 20 valores moderados de madrugada (tests/test_anomalias.py). Con 0,58,
# 0,60 y 0,62 el F1 es casi igual (0,80, 0,79 y 0,81), y 0,62 es el de mayor
# precision (0,93, con exhaustividad de 0,72: todos los picos y el 45 % de las
# contextuales). Se prefiere la precision para no llenar el visor de falsas
# alarmas. En las series reales de PM2.5 marca entre el 1 y el 3 % de las horas
# (docs/bitacora.md, 2026-10-23).
UMBRAL_PUNTAJE = 0.62
MINIMO_MEDICIONES = 24 * 14
SEMILLA = 42
ZONA = ZoneInfo("America/Bogota")


@dataclass
class Resultado:
    modelo: Pipeline  # estandarizacion + Isolation Forest, para guardarlo y reutilizarlo completo
    puntajes: np.ndarray  # mayor = mas anomalo
    anomalas: np.ndarray  # indices de las mediciones senaladas


def caracteristicas(instantes: list[datetime], valores: np.ndarray) -> np.ndarray:
    """Matriz de caracteristicas de una serie horaria ordenada por instante."""
    horas = np.array([i.astimezone(ZONA).hour for i in instantes])
    angulo = 2 * np.pi * horas / 24
    segundos = np.array([i.timestamp() for i in instantes])
    cambio = np.zeros(len(valores))
    consecutivas = np.diff(segundos) == 3600
    cambio[1:][consecutivas] = np.diff(valores)[consecutivas]
    # Mediana de las 24 horas anteriores (sin incluir la actual).
    mediana = np.empty(len(valores))
    inicio = np.searchsorted(segundos, segundos - 24 * 3600)
    for i in range(len(valores)):
        previos = valores[inicio[i]:i]
        mediana[i] = np.median(previos) if len(previos) else valores[i]
    return np.column_stack([valores, np.sin(angulo), np.cos(angulo), cambio, valores - mediana])


def detectar(instantes: list[datetime], valores: np.ndarray,
             umbral: float = UMBRAL_PUNTAJE) -> Resultado | None:
    """Entrena el modelo con la serie y senala las mediciones cuyo puntaje supera el umbral."""
    if len(valores) < MINIMO_MEDICIONES:
        return None
    x = caracteristicas(instantes, np.asarray(valores, dtype=float))
    # Las caracteristicas tienen escalas distintas: se estandarizan.
    modelo = make_pipeline(StandardScaler(), IsolationForest(n_estimators=200, random_state=SEMILLA)).fit(x)
    puntajes = -modelo.score_samples(x)
    return Resultado(modelo, puntajes, np.flatnonzero(puntajes >= umbral))
