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
    monkeypatch.setattr(cali_ckan, "ESTACIONES", [("UV", "Universidad del Valle", 3.37, -76.53, "r1")])
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
def test_idesc_rechaza_capas_en_otro_sistema_de_coordenadas():
    respx.get(idesc.URL).mock(return_value=httpx.Response(200, json={
        "crs": {"properties": {"name": "urn:ogc:def:crs:EPSG::6249"}}, "features": []}))
    try:
        list(idesc.ConectorIdesc().extraer())
    except ValueError as error:
        assert "EPSG:4326" in str(error)
    else:
        raise AssertionError("Debía rechazar una capa en EPSG:6249")
