"""Pruebas de la deteccion de anomalias (RF-13).

La evaluacion sigue la seccion 2.1.10: como las fuentes no marcan sus errores,
se insertan anomalias conocidas en una serie y se mide la precision y la
exhaustividad del metodo.
"""
import json
import os
from datetime import UTC, datetime, timedelta

import numpy as np
import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import sessionmaker

from pimau.analitica import anomalias, ejecutor
from pimau.db.modelos import Anomalia, Base, Medicion

INICIO = datetime(2026, 8, 1, tzinfo=UTC)


def serie_con_anomalias(dias=60, semilla=1):
    """PM2.5 sintetico con ciclo diario, autocorrelacion y 40 anomalias conocidas:
    20 picos y 20 valores moderados en la madrugada (contextuales)."""
    rng = np.random.default_rng(semilla)
    n = 24 * dias
    instantes = [INICIO + timedelta(hours=i) for i in range(n)]
    hora_local = np.array([(i.hour - 5) % 24 for i in instantes])
    nivel = 10 + 6 * np.exp(-((hora_local - 8) ** 2) / 8)
    ruido = np.zeros(n)
    for i in range(1, n):
        ruido[i] = 0.8 * ruido[i - 1] + rng.normal(0, 1.2)
    valores = np.clip(nivel + ruido, 0.5, None)
    picos = rng.choice(np.arange(48, n), 20, replace=False)
    valores[picos] += rng.uniform(25, 60, 20)
    madrugada = [i for i in range(48, n) if hora_local[i] in (2, 3, 4) and i not in picos]
    contextuales = rng.choice(madrugada, 20, replace=False)
    valores[contextuales] += rng.uniform(10, 15, 20)
    return instantes, valores, set(picos.tolist()), set(contextuales.tolist())


def test_precision_y_exhaustividad_con_anomalias_insertadas():
    # Promedio de cinco series, para no depender de una sola muestra aleatoria.
    precisiones, exhaustividades = [], []
    for semilla in range(1, 6):
        instantes, valores, picos, contextuales = serie_con_anomalias(semilla=semilla)
        senaladas = set(anomalias.detectar(instantes, valores).anomalas.tolist())
        verdaderas = picos | contextuales
        assert picos <= senaladas  # todos los picos, en todas las series
        precisiones.append(len(senaladas & verdaderas) / len(senaladas))
        exhaustividades.append(len(senaladas & verdaderas) / len(verdaderas))
    precision, exhaustividad = np.mean(precisiones), np.mean(exhaustividades)
    assert precision >= 0.85 and exhaustividad >= 0.65, (precision, exhaustividad)


def test_series_cortas_no_se_evaluan():
    instantes, valores, _, _ = serie_con_anomalias(dias=10)
    assert anomalias.detectar(instantes, valores) is None


URL = os.environ.get("DATABASE_URL_PRUEBAS")


@pytest.mark.skipif(not URL, reason="Requiere DATABASE_URL_PRUEBAS")
def test_guarda_anomalias_sin_tocar_las_mediciones_y_guarda_el_modelo(tmp_path):
    motor = create_engine(URL)
    with motor.begin() as c:
        c.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    Base.metadata.drop_all(motor)
    Base.metadata.create_all(motor)
    instantes, valores, picos, _ = serie_con_anomalias()
    with motor.begin() as c:
        c.execute(text("""
            INSERT INTO fuente (id, nombre, tipo_api, url_base, activa, frecuencia_min) VALUES (1, 'f', 'p', '-', true, 60);
            INSERT INTO parametro (id, codigo, nombre, unidad, variable) VALUES (1, 'PM25', 'PM2.5', 'µg/m³', 'calidad_aire');
            INSERT INTO estacion (id, fuente_id, codigo_origen, nombre, ubicacion, activa)
                VALUES (1, 1, 'X', 'E', ST_SetSRID(ST_MakePoint(-76.5, 3.4), 4326), true);
            INSERT INTO ejecucion_ingesta (id, fuente_id, inicio, estado) VALUES (1, 1, now(), 'correcta');
        """))
        c.execute(text("""INSERT INTO medicion (estacion_id, parametro_id, ejecucion_id, instante, valor, bandera)
                          VALUES (1, 1, 1, :i, :v, 'valido')"""),
                  [{"i": i, "v": float(v)} for i, v in zip(instantes, valores, strict=True)])
    sesion = sessionmaker(bind=motor)()
    suma_antes = sesion.scalar(select(func.sum(Medicion.valor)))

    nuevas = ejecutor.revisar(sesion, tmp_path, desde=None, todo=True)
    assert nuevas >= 20
    assert ejecutor.revisar(sesion, tmp_path, desde=None, todo=True) == 0  # no duplica
    assert sesion.scalar(select(func.sum(Medicion.valor))) == suma_antes  # no cambia ningun valor
    # Los picos insertados quedaron senalados.
    senaladas = set(sesion.scalars(select(Medicion.instante).join(Anomalia, Anomalia.medicion_id == Medicion.id)))
    assert {instantes[i] for i in picos} <= senaladas

    metadatos = json.loads((tmp_path / "anomalias_estacion1_PM25.json").read_text())
    assert (tmp_path / "anomalias_estacion1_PM25.skops").exists()
    assert metadatos["mediciones"] == len(instantes)
    assert set(metadatos["versiones"]) == {"python", "scikit-learn", "numpy", "skops"}
    sesion.close()
