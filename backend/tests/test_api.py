"""Pruebas de la API contra PostGIS real, con datos sembrados."""
import os
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from pimau.api import app as modulo_app
from pimau.db.modelos import Base

URL = os.environ.get("DATABASE_URL_PRUEBAS")
pytestmark = pytest.mark.skipif(not URL, reason="Requiere DATABASE_URL_PRUEBAS")

FIN = datetime(2024, 12, 31, 23, tzinfo=UTC)


@pytest.fixture
def cliente():
    motor = create_engine(URL)
    with motor.begin() as c:
        c.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    Base.metadata.drop_all(motor)
    Base.metadata.create_all(motor)
    with motor.begin() as c:
        c.execute(text("""
            INSERT INTO fuente (id, nombre, tipo_api, url_base, activa, frecuencia_min)
                VALUES (1, 'Fuente de prueba', 'prueba', '-', true, 60);
            INSERT INTO parametro (id, codigo, nombre, unidad, variable)
                VALUES (1, 'PM25', 'PM2.5', 'µg/m³', 'calidad_aire'), (2, 'PM10', 'PM10', 'µg/m³', 'calidad_aire');
            INSERT INTO umbral_referencia (parametro_id, referencia, categoria, limite_inferior, limite_superior, color)
                VALUES (1, 'ICA Res. 2254 de 2017', 'Buena', 0, 12, '#00E400'),
                       (1, 'ICA Res. 2254 de 2017', 'Aceptable', 13, 37, '#FFFF00'),
                       (1, 'Guía OMS 2021', '24 horas', NULL, 15, NULL);
            INSERT INTO estacion (id, fuente_id, codigo_origen, nombre, ubicacion, activa)
                VALUES (1, 1, 'X', 'Estación de prueba', ST_SetSRID(ST_MakePoint(-76.53, 3.38), 4326), true);
            INSERT INTO ejecucion_ingesta (id, fuente_id, inicio, estado) VALUES (1, 1, now(), 'correcta');
            INSERT INTO capa_territorial (tipo, codigo, nombre, geometria)
                VALUES ('comuna', '01', 'Comuna 01',
                        ST_Multi(ST_GeomFromText('POLYGON((-76.6 3.3,-76.5 3.3,-76.5 3.4,-76.6 3.4,-76.6 3.3))', 4326)));
        """))
        # 24 horas de PM2.5: 20 validas con valor 20 y 4 faltantes; el promedio es 20 (Aceptable).
        for h in range(24):
            instante = FIN - timedelta(hours=h)
            valor, bandera = (None, "faltante") if h in (3, 4, 5, 6) else (20, "valido")
            c.execute(text("""INSERT INTO medicion (estacion_id, parametro_id, ejecucion_id, instante, valor, bandera)
                              VALUES (1, 1, 1, :i, :v, :b)"""), {"i": instante, "v": valor, "b": bandera})
    sesiones = sessionmaker(bind=motor)

    def sesion_de_prueba():
        with sesiones() as s:
            yield s

    modulo_app.app.dependency_overrides[modulo_app.sesion_bd] = sesion_de_prueba
    modulo_app._cache.clear()
    modulo_app._solicitudes.clear()
    yield TestClient(modulo_app.app)
    modulo_app.app.dependency_overrides.clear()


def test_estaciones_con_ica_del_promedio_24h_y_guia_oms(cliente):
    datos = cliente.get("/api/estaciones").json()
    propiedades = datos["features"][0]["properties"]
    pm25 = propiedades["parametros"]["PM25"]
    assert propiedades["fuente"] == "Fuente de prueba"
    assert pm25["instante"].startswith("2024-12-31T23:00")
    assert pm25["instante_ica"].startswith("2024-12-31T23:00")
    assert (pm25["promedio_ica"], pm25["horas_validas_ica"], pm25["ventana_ica_horas"]) == (20.0, 20, 24)
    assert (pm25["categoria"], pm25["ica"]) == ("Aceptable", 65)  # (100-51)/(37-13)*(20-13)+51 = 65,3
    assert pm25["guia_oms"] == {"periodo": "24 horas", "valor": 15.0, "comparable": True}


def test_el_ica_usa_el_ultimo_periodo_representativo(cliente):
    # Una medicion aislada al final de la serie no tiene 18 horas validas en sus
    # 24 horas, asi que el ICA debe seguir saliendo del periodo anterior.
    from sqlalchemy import create_engine
    with create_engine(URL).begin() as c:
        c.execute(text("""INSERT INTO medicion (estacion_id, parametro_id, ejecucion_id, instante, valor, bandera)
                          VALUES (1, 1, 1, :i, 90, 'valido')"""), {"i": FIN + timedelta(days=3)})
    pm25 = cliente.get("/api/estaciones").json()["features"][0]["properties"]["parametros"]["PM25"]
    assert pm25["valor_horario"] == 90.0
    assert pm25["instante_ica"].startswith("2024-12-31T23:00")
    assert pm25["categoria"] == "Aceptable"


def test_parametros_sin_ica_y_agregacion_diaria(cliente):
    from sqlalchemy import create_engine
    with create_engine(URL).begin() as c:
        c.execute(text("""INSERT INTO parametro (id, codigo, nombre, unidad, variable)
                          VALUES (3, 'LLUVIA', 'Lluvia', 'mm', 'meteorologia'), (4, 'DV', 'Dirección del viento', '°', 'meteorologia')"""))
        for h in range(24):
            instante = FIN - timedelta(hours=h)
            c.execute(text("""INSERT INTO medicion (estacion_id, parametro_id, ejecucion_id, instante, valor, bandera)
                              VALUES (1, 3, 1, :i, 1, 'valido'), (1, 4, 1, :i, :d, 'valido')"""),
                      {"i": instante, "d": 350 if h % 2 else 10})
    lluvia = cliente.get("/api/estaciones").json()["features"][0]["properties"]["parametros"]["LLUVIA"]
    assert lluvia["ica"] is None and lluvia["ventana_ica_horas"] is None and lluvia["valor_horario"] == 1.0
    dias = {d["dia"]: d for d in cliente.get("/api/estaciones/1/series", params={
        "parametro": "LLUVIA", "desde": "2024-12-31", "hasta": "2025-01-01", "agregacion": "dia"}).json()["datos"]}
    # El 31 de diciembre (hora de Colombia) tiene 19 horas con 1 mm: la lluvia se suma.
    assert dias["2024-12-31"]["valor"] == 19.0
    viento = cliente.get("/api/estaciones/1/series", params={
        "parametro": "DV", "desde": "2024-12-31", "hasta": "2024-12-31", "agregacion": "dia"}).json()["datos"][0]
    # El promedio de 350° y 10° es cercano a 0°, no 180°. Ese dia tiene 19 horas
    # (10 de un lado y 9 del otro), por eso no da exactamente 0°.
    assert viento["valor"] < 1 or viento["valor"] > 359


def test_rechaza_parametros_desconocidos(cliente):
    r = cliente.get("/api/estaciones/1/series", params={"parametro": "XYZ", "desde": "2024-12-31", "hasta": "2024-12-31"})
    assert r.status_code == 422


def test_serie_horaria_conserva_los_faltantes(cliente):
    r = cliente.get("/api/estaciones/1/series", params={"parametro": "PM25", "desde": "2024-12-31", "hasta": "2024-12-31"})
    datos = r.json()["datos"]
    assert r.status_code == 200
    assert any(d["bandera"] == "faltante" and d["valor"] is None for d in datos)


def test_serie_diaria_exige_horas_suficientes(cliente):
    datos = cliente.get("/api/estaciones/1/series", params={
        "parametro": "PM25", "desde": "2024-12-30", "hasta": "2024-12-31", "agregacion": "dia"}).json()["datos"]
    # Hora de Colombia: el 31 de diciembre tiene 19 horas cargadas, 15 validas (menos de 18).
    assert all(d["valor"] is None or d["horas_validas"] >= 18 for d in datos)


def test_descarga_csv(cliente):
    r = cliente.get("/api/estaciones/1/series.csv", params={"parametro": "PM25", "desde": "2024-12-31", "hasta": "2024-12-31"})
    lineas = r.text.strip().splitlines()
    assert r.headers["content-type"].startswith("text/csv")
    assert lineas[0] == "estacion,fuente,parametro,unidad,instante,valor,bandera"
    assert "Fuente de prueba" in lineas[1]


def test_rechaza_rangos_horarios_demasiado_largos(cliente):
    r = cliente.get("/api/estaciones/1/series", params={"desde": "2020-01-01", "hasta": "2024-12-31"})
    assert r.status_code == 422


def test_estacion_inexistente(cliente):
    assert cliente.get("/api/estaciones/99/series", params={"desde": "2024-12-31", "hasta": "2024-12-31"}).status_code == 404


def test_capa_de_comunas(cliente):
    capa = cliente.get("/api/capas/comuna").json()
    assert capa["features"][0]["properties"]["nombre"] == "Comuna 01"
    assert cliente.get("/api/capas/otra").status_code == 422


def test_las_respuestas_estan_documentadas_con_esquemas(cliente):
    """Cada ruta declara el esquema de su respuesta en OpenAPI (RF-08)."""
    esquemas = cliente.get("/api/openapi.json").json()["components"]["schemas"]
    for nombre in ["ColeccionEstaciones", "EstadoParametro", "Serie", "Parametro", "Rango", "Capa"]:
        assert nombre in esquemas
