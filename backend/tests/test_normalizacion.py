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
