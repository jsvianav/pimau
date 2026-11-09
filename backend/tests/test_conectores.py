from datetime import UTC, datetime
from pathlib import Path

import httpx
import respx
from openpyxl import Workbook

from pimau.ingesta.conectores import cali_ckan, ideam, idesc, satic


@respx.mock
def test_ideam_normaliza_filas_de_cali():
    filas = [
        {"estacion_id": "31820", "nombre_est": "CASCAJAL", "msfl_code": "PM2.5",
         "med_concentracion_estandar": "18", "med_fecha_final": "2024-12-31T23:00:00.000",
         "latitud": "3.39", "longitud": "-76.49", "sigla_unidad": "ug/m3", "duraci_n": "60"},
        {"estacion_id": "31820", "nombre_est": "CASCAJAL", "msfl_code": "P",
         "med_concentracion_estandar": "690", "med_fecha_final": "2024-12-31T23:00:00.000",
         "latitud": "3.39", "longitud": "-76.49", "sigla_unidad": "mmHg", "duraci_n": "60"},
        # Presion ya publicada en hPa aunque diga mmHg: no se convierte.
        {"estacion_id": "30110", "nombre_est": "COMPARTIR", "msfl_code": "P",
         "med_concentracion_estandar": "905.3", "med_fecha_final": "2024-12-31T23:00:00.000",
         "latitud": "3.43", "longitud": "-76.47", "sigla_unidad": "mmHg", "duraci_n": "60"},
        # Promedio diario: no se mezcla con los horarios.
        {"estacion_id": "31820", "nombre_est": "CASCAJAL", "msfl_code": "PM10",
         "med_concentracion_estandar": "40", "med_fecha_final": "2024-12-31T00:00:00.000",
         "latitud": "3.39", "longitud": "-76.49", "sigla_unidad": "ug/m3", "duraci_n": "1440"},
        # Temperatura a 10 m: no se usa.
        {"estacion_id": "31820", "nombre_est": "CASCAJAL", "msfl_code": "TAire10",
         "med_concentracion_estandar": "25", "med_fecha_final": "2024-12-31T23:00:00.000",
         "latitud": "3.39", "longitud": "-76.49", "sigla_unidad": "°C", "duraci_n": "60"},
    ]
    # La descarga es por meses: solo la ventana de diciembre de 2024 devuelve filas.
    ruta = respx.get(ideam.URL).mock(side_effect=lambda request: httpx.Response(
        200, json=filas if "> '2024-12-01" in request.url.params["$where"] else []))
    registros = list(ideam.ConectorIdeam().extraer(None))
    assert ruta.call_count > 100  # una consulta por mes desde 2010
    assert [r.parametro for r in registros] == ["PM25", "PRES", "PRES"]
    assert registros[1].valor == round(690 * 1.333224, 4)  # mmHg a hPa
    assert registros[2].valor == 905.3  # ya estaba en hPa
    r = registros[0]
    assert (r.parametro, r.valor, r.bandera, r.estacion.nombre) == ("PM25", 18.0, "valido", "Cascajal")
    assert r.instante.isoformat() == "2025-01-01T04:00:00+00:00"


@respx.mock
def test_cali_ckan_marca_faltantes_sin_eliminarlos(monkeypatch):
    monkeypatch.setattr(cali_ckan, "ESTACIONES", [cali_ckan.RecursoEstacion("UV", "Universidad del Valle", 3.37, -76.53, "r1")])
    respx.get(cali_ckan.URL).mock(return_value=httpx.Response(200, json={"result": {
        "total": 3,
        "fields": [{"id": "_id"}, {"id": "Fecha & Hora"}, {"id": "PM2,5 (ug/m3)"}, {"id": "O3  (ug/m3)"}],
        "records": [
            {"_id": 1, "Fecha & Hora": "2013-03-01T01:00:00", "PM2,5 (ug/m3)": "4,5", "O3  (ug/m3)": "28"},
            {"_id": 2, "Fecha & Hora": "2013-03-01T02:00:00", "PM2,5 (ug/m3)": "ND", "O3  (ug/m3)": "17"},
            {"_id": 3, "Fecha & Hora": "#¡VALOR!", "PM2,5 (ug/m3)": "7", "O3  (ug/m3)": "17"},
        ]}}))
    conector = cali_ckan.ConectorCaliCkan()
    registros = [r for r in conector.extraer(None) if r.parametro == "PM25"]
    assert [(r.valor, r.bandera) for r in registros] == [(4.5, "valido"), (None, "faltante")]
    assert conector.filas_descartadas == 1


@respx.mock
def test_cali_ckan_resuelve_fechas_de_excel_ambiguas_con_la_secuencia(monkeypatch):
    monkeypatch.setattr(cali_ckan, "ESTACIONES", [cali_ckan.RecursoEstacion(
        "CA", "Cañaveralejo", 3.41, -76.54, "r3", excel_ambiguo=True)])
    respx.get(cali_ckan.URL).mock(return_value=httpx.Response(200, json={"result": {
        "total": 4, "fields": [{"id": "_id"}, {"id": "Fecha & Hora"}, {"id": "PM10 (ug/m3)"}],
        "records": [
            # Periodo invertido: 41646 sigue a 06/30/2014 23:00, asi que es el 1 de julio.
            {"_id": 1, "Fecha & Hora": "06/30/2014 23:00", "PM10 (ug/m3)": "20"},
            {"_id": 2, "Fecha & Hora": "41646", "PM10 (ug/m3)": "21"},
            # Periodo correcto: 43470 sigue al 4 de enero de 2019, asi que es el 5 de enero.
            {"_id": 3, "Fecha & Hora": "43469,95833", "PM10 (ug/m3)": "22"},
            {"_id": 4, "Fecha & Hora": "43470", "PM10 (ug/m3)": "23"},
        ]}}))
    fechas = [r.instante.astimezone(cali_ckan.norma.ZONA_FUENTES).strftime("%Y-%m-%d %H:%M")
              for r in cali_ckan.ConectorCaliCkan().extraer(None)]
    assert fechas == ["2014-06-30 23:00", "2014-07-01 00:00", "2019-01-04 23:00", "2019-01-05 00:00"]


@respx.mock
def test_cali_ckan_lee_base_aerea_desde_el_csv(monkeypatch):
    monkeypatch.setattr(cali_ckan, "ESTACIONES", [cali_ckan.RecursoEstacion(
        "BA", "Base Aérea", 3.45, -76.50, "r2", acceso="csv", orden_fecha="dmy")])
    respx.get(cali_ckan.URL_RECURSO).mock(return_value=httpx.Response(200, json={"result": {"url": "https://ejemplo/ba.csv"}}))
    contenido = "\ufeff_id;Fecha & Hora;PM2.5 (ug/m3);SO2  (ug/m3)\r\n1;31/12/2019 23:00;10;ND\r\n2;31/12/2019 24:00;ND;ND\r\n"
    respx.get("https://ejemplo/ba.csv").mock(return_value=httpx.Response(200, content=contenido.encode("utf-8")))
    registros = [r for r in cali_ckan.ConectorCaliCkan().extraer(None) if r.parametro == "PM25"]
    assert [(r.instante.isoformat(), r.valor, r.bandera) for r in registros] == [
        ("2020-01-01T04:00:00+00:00", 10.0, "valido"),
        ("2020-01-01T05:00:00+00:00", None, "faltante"),
    ]


@respx.mock
def test_idesc_rechaza_capas_en_otro_sistema_de_coordenadas():
    respx.get(idesc.URL).mock(return_value=httpx.Response(200, json={
        "crs": {"properties": {"name": "urn:ogc:def:crs:EPSG::6249"}}, "features": []}))
    try:
        list(idesc.ConectorIdesc().extraer())
    except ValueError as error:
        assert "EPSG:4326" in str(error)
    else:
        raise AssertionError("Debía rechazar una capa en EPSG:6249")


@respx.mock
def test_ideam_guarda_la_fecha_de_publicacion_del_conjunto():
    """La fecha de la última actualización del conjunto queda en cada medición (RF-04)."""
    fila = {"estacion_id": "31820", "nombre_est": "CASCAJAL", "msfl_code": "PM2.5",
            "med_concentracion_estandar": "18", "med_fecha_final": "2024-12-31T23:00:00.000",
            "latitud": "3.39", "longitud": "-76.49", "sigla_unidad": "ug/m3", "duraci_n": "60"}
    respx.get(ideam.URL_METADATOS).mock(return_value=httpx.Response(200, json={"rowsUpdatedAt": 1771590892}))
    respx.get(ideam.URL).mock(side_effect=lambda request: httpx.Response(
        200, json=[fila] if "> '2024-12-01" in request.url.params["$where"] else []))
    registros = list(ideam.ConectorIdeam().extraer(None))
    assert registros[0].fecha_publicacion == datetime(2026, 2, 20, 12, 34, 52, tzinfo=UTC)


@respx.mock
def test_cali_ckan_guarda_la_fecha_de_publicacion_del_recurso(monkeypatch):
    monkeypatch.setattr(cali_ckan, "ESTACIONES", [cali_ckan.RecursoEstacion("UV", "Universidad del Valle", 3.37, -76.53, "r1")])
    respx.get(cali_ckan.URL_RECURSO).mock(return_value=httpx.Response(200, json={"result": {
        "last_modified": "2020-09-18T20:25:12.459029"}}))
    respx.get(cali_ckan.URL).mock(return_value=httpx.Response(200, json={"result": {
        "total": 1, "records": [{"_id": 1, "Fecha & Hora": "2013-03-01T01:00:00", "PM2,5 (ug/m3)": "4,5"}]}}))
    registro = next(cali_ckan.ConectorCaliCkan().extraer(None))
    assert registro.fecha_publicacion == datetime(2020, 9, 18, 20, 25, 12, 459029, tzinfo=UTC)


DATOS = Path(__file__).parent / "datos"


def test_satic_agrega_el_archivo_exportado_a_promedios_horarios():
    # Archivo descargado del geoportal de SATIC el 2026-10-21 (PM2.5 de Holguines).
    conector = satic.ConectorSatic(bandeja=DATOS)
    registros = list(conector.extraer(None))
    # 45 lecturas en 29 horas; la primera y la ultima hora no se guardan.
    assert len(registros) == 27
    assert {r.parametro for r in registros} == {"PM25"}
    r = registros[0]
    assert (r.estacion.codigo, r.estacion.nombre) == ("OAC22-HOLGUINES", "Holguines Trade Center")
    # El archivo se bajo con un navegador en hora de Colombia, asi que su hora es
    # la UTC real: la primera hora que se guarda (04:xx) es la que termina a las 05:00 UTC.
    assert (r.instante.isoformat(), r.valor, r.bandera) == ("2026-10-20T05:00:00+00:00", 5.0, "valido")
    assert conector.filas_descartadas == 0


def test_satic_promedia_la_direccion_del_viento_como_angulo_y_descarta_estaciones_desconocidas(tmp_path):
    libro = Workbook()
    hoja = libro.active
    hoja.append(["nom_sensor", "nom_corto", "dato_sensor", "fecha_registro_dato_sensor"])
    for minuto, grados in [(5, 340), (20, 350), (40, 10), (55, 20)]:
        for hora in (9, 10, 11):
            hoja.append(["WDIR_AVG - USB", "WDIR_AVG", grados, f"21/10/2026 {hora:02d}:{minuto:02d}:00"])
    hoja.append(["CO2_AVG - USB", "CO2_AVG", 410, "21/10/2026 10:10:00"])  # variable que PIMAU no carga
    hoja.append(["PM25_AVG - LAS GARZAS", "PM25_AVG", 12, "21/10/2026 10:10:00"])  # codigo desconocido
    libro.save(tmp_path / "exportado.xlsx")

    conector = satic.ConectorSatic(bandeja=tmp_path)
    registros = list(conector.extraer(None))
    # De tres horas solo queda la del medio (10:xx UTC); su promedio vectorial es
    # 0 grados, no 180.
    assert [(r.parametro, r.instante.isoformat(), r.valor) for r in registros] == [
        ("DV", "2026-10-21T11:00:00+00:00", 0.0)]
    assert conector.filas_descartadas == 1


def test_satic_sin_archivos_no_falla(tmp_path):
    assert list(satic.ConectorSatic(bandeja=tmp_path / "no_existe").extraer(None)) == []


def test_descarga_satic_usa_un_nombre_fijo_por_estacion_y_variable():
    from pimau.ingesta.descarga_satic import nombre_archivo
    assert nombre_archivo("PM25_AVG - NEW CAMBRIDGE (PM25_AVG)") == "PM25_AVG_-_NEW_CAMBRIDGE.xlsx"
    assert nombre_archivo(" TEMP_AVG - USB (TEMP_AVG)") == "TEMP_AVG_-_USB.xlsx"


def test_satic_marca_como_sospechoso_un_sensor_que_repite_el_mismo_valor(tmp_path):
    # Como el PM2.5 de la Javeriana en octubre de 2026: 0 en todas las lecturas.
    libro = Workbook()
    hoja = libro.active
    hoja.append(["nom_sensor", "nom_corto", "dato_sensor", "fecha_registro_dato_sensor"])
    for hora in range(9):
        hoja.append(["PM25_AVG - JAVERIANA", "PM25_AVG", 0, f"21/10/2026 {hora:02d}:30:00"])
        hoja.append(["PM25_AVG - USB", "PM25_AVG", 10 + hora, f"21/10/2026 {hora:02d}:30:00"])
    libro.save(tmp_path / "exportado.xlsx")

    registros = list(satic.ConectorSatic(bandeja=tmp_path).extraer(None))
    banderas = {(r.estacion.codigo, r.bandera) for r in registros}
    # Nueve horas iguales en la Javeriana; se guardan siete (sin la primera ni la ultima).
    assert banderas == {("OAC22-JAVERIANA", "sospechoso"), ("OAC22-USB", "valido")}
    assert sum(r.estacion.codigo == "OAC22-JAVERIANA" for r in registros) == 7


def test_satic_descarta_las_lecturas_que_quedarian_en_el_futuro(tmp_path):
    # Si SATIC cambiara de zona horaria, sus lecturas quedarian adelantadas.
    libro = Workbook()
    hoja = libro.active
    hoja.append(["nom_sensor", "nom_corto", "dato_sensor", "fecha_registro_dato_sensor"])
    for hora in range(6):
        hoja.append(["PM25_AVG - USB", "PM25_AVG", 10 + hora, f"22/10/2026 {hora:02d}:30:00"])
    libro.save(tmp_path / "exportado.xlsx")
    # A las 03:00 UTC, las lecturas de las 03:30, 04:30 y 05:30 todavia no pueden existir.
    conector = satic.ConectorSatic(bandeja=tmp_path, ahora=datetime(2026, 10, 22, 3, 0, tzinfo=UTC))
    registros = list(conector.extraer(None))
    assert conector.filas_descartadas == 3
    assert max(r.instante for r in registros) <= datetime(2026, 10, 22, 3, 0, tzinfo=UTC)


def test_satic_advierte_cuando_la_descarga_automatica_lleva_horas_fallando(tmp_path):
    from datetime import timedelta

    from pimau.ingesta.descarga_satic import guardar_estado
    ahora = datetime(2026, 10, 22, 21, tzinfo=UTC)
    guardar_estado(tmp_path, 69, None, ahora=ahora - timedelta(hours=19))
    guardar_estado(tmp_path, 0, "TimeoutError: la página no cargó", ahora=ahora - timedelta(minutes=5))

    conector = satic.ConectorSatic(bandeja=tmp_path, ahora=ahora)
    list(conector.extraer(None))
    # La falla conserva la fecha del último éxito.
    assert conector.advertencias == ["Advertencia: la descarga automática de SATIC falla desde el "
                                     "2026-10-22 02:00 UTC (TimeoutError: la página no cargó)"]

    guardar_estado(tmp_path, 69, None, ahora=ahora)
    conector = satic.ConectorSatic(bandeja=tmp_path, ahora=ahora)
    list(conector.extraer(None))
    assert conector.advertencias == []

    # Sin error, pero sin descargas en horas: el descargador estuvo apagado, no falló.
    conector = satic.ConectorSatic(bandeja=tmp_path, ahora=ahora + timedelta(hours=5))
    list(conector.extraer(None))
    assert conector.advertencias == ["Advertencia: no hay descargas nuevas de SATIC desde el 2026-10-22 21:00 UTC; "
                                     "el descargador no ha vuelto a correr o está apagado"]


def test_satic_promedia_el_ruido_por_energia():
    # 50 y 70 dB no promedian 60: el nivel equivalente (67 dB) queda cerca del más alto.
    assert satic.promedio("RUIDO", [50, 70]) == 67.0329
    assert satic.promedio("RUIDO", [60, 60, 60]) == 60.0
