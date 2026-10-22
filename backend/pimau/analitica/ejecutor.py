"""Proceso por lotes de deteccion de anomalias (RF-13, ADR-06).

Para cada serie (estacion y parametro) entrena un Isolation Forest con el
ultimo ano de mediciones validas, senala las anomalias y las guarda en la tabla
anomalia. Senalar no modifica la medicion. Repetirlo no duplica anomalias.

Cada modelo se guarda como archivo para poder reutilizarlo o exportarlo sin
volver a entrenarlo (seccion de Construccion del Capitulo 3): con skops, que a
diferencia de pickle no ejecuta codigo al cargarlo, y junto a un JSON con la
estacion, el parametro, el periodo, la fecha de entrenamiento, el resultado y
las versiones de las librerias.
"""
import json
import logging
import platform
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import sklearn
import skops
import skops.io
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from pimau.analitica import anomalias
from pimau.db.modelos import Anomalia

log = logging.getLogger("pimau.analitica")

# Contaminantes con ICA, meteorologia de nivel y ruido. La lluvia, la radiacion
# y el viento pasan de cero a valores altos de forma natural, y sus "picos" no
# son errores; el sulfuro de hidrogeno solo tiene historico.
PARAMETROS = ("PM25", "PM10", "O3", "NO2", "SO2", "CO", "TEMP", "HUM", "RUIDO")
VENTANA = timedelta(days=365)


def series_a_revisar(sesion: Session, desde: datetime | None) -> list[tuple[int, int, str]]:
    """Series con mediciones validas desde una fecha (o todas, si desde es None)."""
    filas = sesion.execute(text("""
        SELECT DISTINCT m.estacion_id, m.parametro_id, p.codigo
        FROM medicion m JOIN parametro p ON p.id = m.parametro_id
        WHERE p.codigo = ANY(:codigos) AND m.bandera = 'valido'
          AND (CAST(:desde AS timestamptz) IS NULL OR m.instante >= :desde)
        ORDER BY 1, 2
    """), {"codigos": list(PARAMETROS), "desde": desde})
    return [tuple(f) for f in filas]


def _mediciones(sesion, estacion_id, parametro_id, inicio, fin):
    filas = sesion.execute(text("""
        SELECT id, instante, valor FROM medicion
        WHERE estacion_id = :e AND parametro_id = :p AND bandera = 'valido'
          AND instante > :i AND instante <= :f
        ORDER BY instante
    """), {"e": estacion_id, "p": parametro_id, "i": inicio, "f": fin}).all()
    return [f.id for f in filas], [f.instante for f in filas], np.array([float(f.valor) for f in filas])


def _ventanas(sesion, estacion_id, parametro_id, todo: bool):
    """Ventanas de un ano que terminan en la ultima medicion; con todo=True, hasta cubrir la serie."""
    inicio, fin = sesion.execute(text("""
        SELECT min(instante), max(instante) FROM medicion
        WHERE estacion_id = :e AND parametro_id = :p AND bandera = 'valido'
    """), {"e": estacion_id, "p": parametro_id}).one()
    if fin is None:
        return []
    ventanas = [(fin - VENTANA, fin)]
    while todo and ventanas[-1][0] > inicio:
        ventanas.append((ventanas[-1][0] - VENTANA, ventanas[-1][0]))
    return ventanas


def guardar_modelo(carpeta: Path, estacion_id: int, codigo: str, resultado, instantes, ahora: datetime):
    carpeta.mkdir(parents=True, exist_ok=True)
    nombre = f"anomalias_estacion{estacion_id}_{codigo}"
    skops.io.dump(resultado.modelo, carpeta / f"{nombre}.skops")
    metadatos = {
        "estacion_id": estacion_id, "parametro": codigo, "metodo": anomalias.METODO,
        "periodo": {"desde": instantes[0].isoformat(), "hasta": instantes[-1].isoformat()},
        "mediciones": len(instantes), "entrenado_en": ahora.isoformat(),
        "umbral_puntaje": anomalias.UMBRAL_PUNTAJE, "anomalias": int(len(resultado.anomalas)),
        "proporcion_anomalias": round(len(resultado.anomalas) / len(instantes), 4),
        "versiones": {"python": platform.python_version(), "scikit-learn": sklearn.__version__,
                      "numpy": np.__version__, "skops": skops.__version__},
    }
    (carpeta / f"{nombre}.json").write_text(json.dumps(metadatos, ensure_ascii=False, indent=2))


def revisar_serie(sesion: Session, estacion_id: int, parametro_id: int, codigo: str, carpeta: Path,
                  revisar_desde: datetime | None = None, todo: bool = False,
                  ahora: datetime | None = None) -> int:
    """Detecta y guarda las anomalias de una serie. Devuelve cuantas anomalias nuevas guardo."""
    ahora = ahora or datetime.now(UTC)
    nuevas = 0
    for i, (inicio, fin) in enumerate(_ventanas(sesion, estacion_id, parametro_id, todo)):
        ids, instantes, valores = _mediciones(sesion, estacion_id, parametro_id, inicio, fin)
        resultado = anomalias.detectar(instantes, valores)
        if resultado is None:
            continue
        if i == 0:  # se guarda el modelo vigente, el de la ventana mas reciente
            guardar_modelo(carpeta, estacion_id, codigo, resultado, instantes, ahora)
        filas = [{"medicion_id": ids[j], "metodo": anomalias.METODO,
                  "puntaje": round(float(resultado.puntajes[j]), 4), "detectada_en": ahora}
                 for j in resultado.anomalas if revisar_desde is None or instantes[j] >= revisar_desde]
        if filas:
            insertadas = sesion.execute(insert(Anomalia).values(filas)
                                        .on_conflict_do_nothing(index_elements=["medicion_id"])
                                        .returning(Anomalia.id))
            nuevas += len(insertadas.all())
        sesion.commit()
    return nuevas


def revisar(sesion: Session, carpeta: Path, desde: datetime | None, todo: bool = False) -> int:
    """Revisa todas las series con datos desde una fecha. Una serie que falla no detiene las demas."""
    total = 0
    for estacion_id, parametro_id, codigo in series_a_revisar(sesion, None if todo else desde):
        try:
            total += revisar_serie(sesion, estacion_id, parametro_id, codigo, carpeta,
                                   revisar_desde=None if todo else desde, todo=todo)
        except Exception:
            sesion.rollback()
            log.exception("Falló la revisión de la estación %s, parámetro %s", estacion_id, codigo)
    return total
