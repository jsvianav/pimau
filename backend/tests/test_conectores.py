import httpx
import respx

from pimau.ingesta.conectores import cali_ckan, ideam, idesc


@respx.mock
def test_ideam_normaliza_filas_de_cali():
    respx.get(ideam.URL).mock(return_value=httpx.Response(200, json=[
        {"estacion_id": "31820", "nombre_est": "CASCAJAL", "msfl_code": "PM2.5",
         "med_concentracion_estandar": "18", "med_fecha_final": "2024-12-31T23:00:00.000",
         "latitud": "3.39", "longitud": "-76.49", "sigla_unidad": "ug/m3"},
        {"estacion_id": "31820", "nombre_est": "CASCAJAL", "msfl_code": "TAire2",
         "med_concentracion_estandar": "25", "med_fecha_final": "2024-12-31T23:00:00.000",
         "latitud": "3.39", "longitud": "-76.49", "sigla_unidad": "°C"},
    ]))
    registros = list(ideam.ConectorIdeam().extraer(None))
    assert len(registros) == 1  # la temperatura no es parte del MVP
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
    registros = list(conector.extraer(None))
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
    registros = list(cali_ckan.ConectorCaliCkan().extraer(None))
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
