from datetime import datetime, timezone

import pytest

from pimau.ingesta import normalizacion as norma


@pytest.mark.parametrize("texto, esperado", [
    ("4", 4.0), ("11,41", 11.41), ("12.5", 12.5), ("1.234,5", 1234.5),
    ("ND", None), ("nd", None), ("", None), (None, None), ("-", None), ("abc", None),
])
def test_leer_numero(texto, esperado):
    assert norma.leer_numero(texto) == esperado


@pytest.mark.parametrize("texto", [
    "2013-03-01T01:00:00", "2020-01-01T01:00:00.000", "03/01/2013 01:00",
])
def test_leer_fecha_convierte_hora_de_colombia_a_utc(texto):
    # 01:00 en Colombia (UTC-5) son las 06:00 UTC.
    assert norma.leer_fecha(texto) == datetime(2013 if "2013" in texto else 2020, 3 if "2013" in texto else 1, 1, 6, 0, tzinfo=timezone.utc)


def test_leer_fecha_acepta_numeros_de_serie_de_excel():
    # 41646 es el 7 de enero de 2014 a las 00:00 en Colombia.
    assert norma.leer_fecha("41646") == datetime(2014, 1, 7, 5, 0, tzinfo=timezone.utc)
    assert norma.leer_fecha("41646.5") == datetime(2014, 1, 7, 17, 0, tzinfo=timezone.utc)
    # Con coma decimal, como en Cañaveralejo y La Ermita: 01:00 en Colombia.
    assert norma.leer_fecha("41646,04167") == datetime(2014, 1, 7, 6, 0, tzinfo=timezone.utc)


def test_leer_fecha_respeta_el_orden_declarado():
    # 05/06/2019 es ambigua: el orden lo declara cada recurso.
    assert norma.leer_fecha("05/06/2019 10:00", orden="mdy").month == 5
    assert norma.leer_fecha("05/06/2019 10:00", orden="dmy").month == 6


def test_leer_fecha_convierte_la_hora_24_en_el_dia_siguiente():
    # 31/12/2019 24:00 en Colombia es el 1 de enero de 2020 a las 05:00 UTC.
    assert norma.leer_fecha("31/12/2019 24:00", orden="dmy") == datetime(2020, 1, 1, 5, 0, tzinfo=timezone.utc)


def test_leer_fecha_corrige_fechas_de_excel_invertidas():
    # En Cañaveralejo, despues de 06/30/2014 23:00 viene 41646, que Excel
    # leyo como 7 de enero de 2014 pero corresponde al 1 de julio de 2014.
    assert norma.leer_fecha("41646", excel_invertido=True) == datetime(2014, 7, 1, 5, 0, tzinfo=timezone.utc)
    assert norma.leer_fecha("41980,95833", excel_invertido=True) == datetime(2014, 7, 13, 4, 0, tzinfo=timezone.utc)


def test_leer_fecha_rechaza_formatos_desconocidos():
    with pytest.raises(ValueError):
        norma.leer_fecha("ayer a las tres")


@pytest.mark.parametrize("columna, codigo", [
    ("PM2,5 (ug/m3)", "PM25"), ("PM2.5 (ug/m3)", "PM25"), ("PM2.5", "PM25"),
    ("PM10 (ug/m3)", "PM10"), ("PM10", "PM10"), ("O3  (ug/m3)", None), ("Fecha & Hora", None),
])
def test_codigo_parametro(columna, codigo):
    assert norma.codigo_parametro(columna) == codigo


@pytest.mark.parametrize("valor, esperada", [
    (None, "faltante"), (0.0, "valido"), (35.2, "valido"), (-1.0, "fuera_de_rango"), (1500.0, "fuera_de_rango"),
])
def test_bandera_pm25(valor, esperada):
    assert norma.bandera("PM25", valor) == esperada


@pytest.mark.parametrize("texto, esperado", [
    ("UNIVERSIDAD DEL VALLE", "Universidad del Valle"), ("BASE AÉREA", "Base Aérea"),
    ("ERA OBRERO", "Era Obrero"), ("LA FLORA", "La Flora"),
    ("TRANSITORIA-NAVARRO", "Transitoria-Navarro"),
])
def test_nombre_propio(texto, esperado):
    assert norma.nombre_propio(texto) == esperado
