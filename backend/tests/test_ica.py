"""Clasificacion del ICA en los limites de cada categoria (plan de verificacion)."""
import pytest

from pimau.api import ica

# Tabla 6 de la Resolucion 2254 de 2017, PM2.5 en 24 horas.
CORTES_PM25 = [ica.PuntoCorte(c, i, s, None) for c, i, s in [
    ("Buena", 0, 12), ("Aceptable", 13, 37), ("Dañina a la salud de grupos sensibles", 38, 55),
    ("Dañina a la salud", 56, 150), ("Muy dañina a la salud", 151, 250), ("Peligrosa", 251, 500)]]


@pytest.mark.parametrize("concentracion, categoria, indice", [
    (0, "Buena", 0), (12, "Buena", 50),
    (13, "Aceptable", 51), (37, "Aceptable", 100),
    (38, "Dañina a la salud de grupos sensibles", 101), (55, "Dañina a la salud de grupos sensibles", 150),
    (56, "Dañina a la salud", 151), (150, "Dañina a la salud", 200),
    (151, "Muy dañina a la salud", 201), (250, "Muy dañina a la salud", 300),
    (251, "Peligrosa", 301), (500, "Peligrosa", 500),
])
def test_limites_de_cada_categoria(concentracion, categoria, indice):
    resultado = ica.calcular(concentracion, CORTES_PM25)
    assert (resultado.categoria, resultado.valor) == (categoria, indice)


def test_los_decimales_entre_cortes_se_truncan():
    assert ica.calcular(12.9, CORTES_PM25).categoria == "Buena"
    assert ica.calcular(37.4, CORTES_PM25).categoria == "Aceptable"


def test_valores_sin_ica():
    assert ica.calcular(None, CORTES_PM25) is None
    assert ica.calcular(-1, CORTES_PM25) is None
    assert ica.calcular(700, CORTES_PM25).categoria == "Peligrosa"


def test_ventanas_y_minimos_por_contaminante():
    assert (ica.VENTANAS_HORAS["CO"], ica.minimo_horas("CO")) == (8, 6)
    assert (ica.VENTANAS_HORAS["NO2"], ica.minimo_horas("NO2")) == (1, 1)
    assert ica.minimo_horas("PM25") == 18


def test_ozono_por_encima_de_393_no_se_clasifica_con_8_horas():
    cortes_o3 = [ica.PuntoCorte(c, i, s, None) for c, i, s in [
        ("Buena", 0, 106), ("Aceptable", 107, 138), ("Dañina a la salud de grupos sensibles", 139, 167),
        ("Dañina a la salud", 168, 207), ("Muy dañina a la salud", 208, 393)]]
    assert ica.calcular(120, cortes_o3, sin_categoria_superior=True).categoria == "Aceptable"
    assert ica.calcular(400, cortes_o3, sin_categoria_superior=True) is None
