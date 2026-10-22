"""Pruebas de la API contra PostGIS real, con datos sembrados."""
import os
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from pimau.api import app as modulo_app
from pimau.api import seguridad
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
            INSERT INTO fuente (id, nombre, tipo_api, url_base, activa, frecuencia_min)
                VALUES (2, 'SATIC (red OAC22)', 'Archivos', '-', true, 60);
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
    seguridad.reiniciar_fallos()
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


def test_estaciones_avisan_si_las_ultimas_mediciones_son_sospechosas(cliente):
    # Despues del ultimo valor valido llegan seis horas con el sensor detenido.
    with create_engine(URL).begin() as c:
        for h in range(1, 7):
            c.execute(text("""INSERT INTO medicion (estacion_id, parametro_id, ejecucion_id, instante, valor, bandera)
                              VALUES (1, 1, 1, :i, 0, 'sospechoso')"""), {"i": FIN + timedelta(hours=h)})
        # El PM10 solo tiene mediciones sospechosas: aparece sin valor, pero con la marca.
        c.execute(text("""INSERT INTO medicion (estacion_id, parametro_id, ejecucion_id, instante, valor, bandera)
                          VALUES (1, 2, 1, :i, 0, 'sospechoso')"""), {"i": FIN})
    parametros = cliente.get("/api/estaciones").json()["features"][0]["properties"]["parametros"]
    assert parametros["PM25"]["instante"].startswith("2024-12-31T23:00")
    assert parametros["PM25"]["ultima_marcada"]["bandera"] == "sospechoso"
    assert parametros["PM25"]["ultima_marcada"]["instante"].startswith("2025-01-01T05:00")
    assert (parametros["PM10"]["instante"], parametros["PM10"]["valor_horario"]) == (None, None)
    assert parametros["PM10"]["ultima_marcada"]["bandera"] == "sospechoso"


# --- Administración (incremento 3) -------------------------------------------------
CORREO, CLAVE = "admin@prueba.local", "clave-de-prueba-larga"


@pytest.fixture
def admin(cliente):
    with create_engine(URL).begin() as c:
        c.execute(text("INSERT INTO administrador (correo, hash_clave, activo) VALUES (:c, :h, true)"),
                  {"c": CORREO, "h": seguridad.cifrar_clave(CLAVE)})
    token = cliente.post("/api/admin/sesion", json={"correo": CORREO, "clave": CLAVE}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def _auditoria():
    with create_engine(URL).connect() as c:
        return c.execute(text("SELECT accion, resultado, administrador_id FROM registro_auditoria ORDER BY id")).all()


def test_escenario_4_rechaza_y_registra_todo_acceso_sin_credenciales_validas(cliente, admin):
    vencido = jwt.encode({"sub": "1", "exp": datetime.now(UTC) - timedelta(minutes=1)},
                         seguridad._secreto, algorithm="HS256")
    alterado = admin["Authorization"][:-3] + "abc"
    intentos = [{}, {"Authorization": f"Bearer {vencido}"}, {"Authorization": alterado},
                {"Authorization": "Bearer no-es-un-token"}]
    for cabeceras in intentos:
        for metodo, ruta in [("get", "/api/admin/fuentes"), ("get", "/api/admin/ejecuciones"),
                             ("get", "/api/admin/auditoria"), ("patch", "/api/admin/fuentes/1")]:
            respuesta = getattr(cliente, metodo)(ruta, headers=cabeceras,
                                                 **({"json": {"activa": False}} if metodo == "patch" else {}))
            assert respuesta.status_code == 401, (ruta, cabeceras)
    rechazados = [a for a in _auditoria() if a.resultado == "rechazado"]
    assert len(rechazados) == len(intentos) * 4
    # Ningún intento cambió la fuente.
    assert cliente.get("/api/admin/fuentes", headers=admin).json()[0]["activa"] is True


def test_inicio_de_sesion_no_revela_que_correos_existen_y_se_bloquea(cliente, admin):
    malo = cliente.post("/api/admin/sesion", json={"correo": CORREO, "clave": "otra-clave-cualquiera"})
    inexistente = cliente.post("/api/admin/sesion", json={"correo": "nadie@prueba.local", "clave": "x" * 14})
    assert malo.status_code == inexistente.status_code == 401
    assert malo.json() == inexistente.json()
    for _ in range(4):
        cliente.post("/api/admin/sesion", json={"correo": CORREO, "clave": "otra-clave-cualquiera"})
    # Quinto fallo cumplido: ni siquiera la clave correcta entra durante el bloqueo.
    assert cliente.post("/api/admin/sesion", json={"correo": CORREO, "clave": CLAVE}).status_code == 429


def test_panel_muestra_el_estado_y_audita_los_cambios(cliente, admin):
    fuentes = cliente.get("/api/admin/fuentes", headers=admin).json()
    prueba = next(f for f in fuentes if f["id"] == 1)
    assert prueba["ultima_ejecucion"]["estado"] == "correcta"
    assert prueba["con_conector"] is False
    satic = next(f for f in fuentes if f["nombre"] == "SATIC (red OAC22)")
    assert satic["con_conector"] is True and satic["ultima_ejecucion"] is None

    cambio = cliente.patch(f"/api/admin/fuentes/{satic['id']}", headers=admin, json={"frecuencia_min": 120})
    assert cambio.status_code == 200 and cambio.json()["frecuencia_min"] == 120
    # Fuera de rango y fuente sin conector.
    assert cliente.patch("/api/admin/fuentes/2", headers=admin, json={"frecuencia_min": 5}).status_code == 422
    cliente.patch("/api/admin/fuentes/1", headers=admin, json={"activa": False})
    assert cliente.patch("/api/admin/fuentes/1", headers=admin, json={"activa": True}).status_code == 409

    acciones = [a.accion for a in _auditoria() if a.administrador_id is not None]
    assert "Inicio de sesión" in acciones
    assert "Cambio de SATIC (red OAC22): frecuencia 60 → 120 min" in acciones
    auditoria = cliente.get("/api/admin/auditoria", headers=admin).json()
    assert auditoria[0]["administrador"] == CORREO



# --- Alertas (RF-14) y anomalías (RF-13) ---------------------------------------------
def _medicion_reciente(c, estacion_id, parametro_id, horas_atras, valor):
    instante = datetime.now(UTC).replace(minute=0, second=0, microsecond=0) - timedelta(hours=horas_atras)
    return c.execute(text("""INSERT INTO medicion (estacion_id, parametro_id, ejecucion_id, instante, valor, bandera)
                             VALUES (:e, :p, 1, :i, :v, 'valido') RETURNING id"""),
                     {"e": estacion_id, "p": parametro_id, "i": instante, "v": valor}).scalar()


def test_alertas_por_umbral_incluyen_el_valor_igual_al_limite(cliente, admin):
    with create_engine(URL).begin() as c:
        c.execute(text("""INSERT INTO estacion (id, fuente_id, codigo_origen, nombre, ubicacion, activa) VALUES
            (2, 1, 'Y', 'Estación reciente', ST_SetSRID(ST_MakePoint(-76.52, 3.37), 4326), true),
            (3, 1, 'Z', 'Estación vieja', ST_SetSRID(ST_MakePoint(-76.51, 3.36), 4326), true)"""))
        _medicion_reciente(c, 2, 1, 1, 37.0)   # igual al umbral, de hace 1 hora: alerta
        _medicion_reciente(c, 3, 1, 5, 80.0)   # supera, pero es de hace 5 horas: no está activa
    assert cliente.get("/api/alertas").json() == []  # sin umbral configurado no hay alertas

    respuesta = cliente.put("/api/admin/umbrales/PM25", headers=admin, json={"valor": 37, "activo": True})
    assert respuesta.status_code == 200 and respuesta.json()["valor"] == 37
    modulo_app._cache.clear()
    alertas = cliente.get("/api/alertas").json()
    assert [(a["estacion"], a["valor"], a["umbral"]) for a in alertas] == [("Estación reciente", 37.0, 37.0)]

    cliente.put("/api/admin/umbrales/PM25", headers=admin, json={"valor": 37, "activo": False})
    assert cliente.get("/api/alertas").json() == []
    assert cliente.put("/api/admin/umbrales/PM25", json={"valor": 37}).status_code == 401
    assert cliente.put("/api/admin/umbrales/PM25", headers=admin, json={"valor": -1}).status_code == 422
    acciones = [a.accion for a in _auditoria() if a.administrador_id is not None]
    assert "Umbral de alerta de PM25: sin umbral → 37 activo µg/m³" in acciones
    umbrales = {u["codigo"]: u for u in cliente.get("/api/admin/umbrales", headers=admin).json()}
    assert umbrales["PM25"]["activo"] is False and umbrales["PM10"]["valor"] is None


def test_series_y_estaciones_senalan_las_anomalias(cliente):
    with create_engine(URL).begin() as c:
        c.execute(text("""INSERT INTO estacion (id, fuente_id, codigo_origen, nombre, ubicacion, activa) VALUES
            (2, 1, 'Y', 'Estación reciente', ST_SetSRID(ST_MakePoint(-76.52, 3.37), 4326), true)"""))
        normal = _medicion_reciente(c, 2, 1, 2, 10.0)
        pico = _medicion_reciente(c, 2, 1, 1, 90.0)
        c.execute(text("INSERT INTO anomalia (medicion_id, metodo, puntaje, detectada_en) "
                       "VALUES (:m, 'Isolation Forest', 0.71, now())"), {"m": pico})
    estado = next(f for f in cliente.get("/api/estaciones").json()["features"]
                  if f["properties"]["id"] == 2)["properties"]["parametros"]["PM25"]
    assert (estado["anomalias_48h"], estado["ultima_anomala"]) == (1, True)
    hoy = datetime.now(UTC).date()
    datos = cliente.get(f"/api/estaciones/2/series?parametro=PM25&desde={hoy - timedelta(days=1)}"
                        f"&hasta={hoy + timedelta(days=1)}").json()["datos"]
    assert [(d["valor"], d["anomalia"]) for d in datos] == [(10.0, False), (90.0, True)]
    assert normal is not None
