"""Pruebas de integracion contra PostGIS real (levantado con Docker Compose).

Usan la base indicada en DATABASE_URL_PRUEBAS y la reconstruyen en cada prueba.
"""
import os
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import sessionmaker

from pimau.db.modelos import Base, Fuente, Medicion, Parametro
from pimau.ingesta import ejecutor
from pimau.ingesta.conectores.base import ConectorMediciones, EstacionOrigen, RegistroMedicion

URL = os.environ.get("DATABASE_URL_PRUEBAS")
pytestmark = pytest.mark.skipif(not URL, reason="Requiere DATABASE_URL_PRUEBAS")

ESTACION = EstacionOrigen("X1", "Estación de prueba", 3.4, -76.5)


def _registro(hora, valor, bandera="valido"):
    return RegistroMedicion(ESTACION, "PM25", datetime(2024, 1, 1, hora, tzinfo=UTC), valor, bandera)


class ConectorFijo(ConectorMediciones):
    def __init__(self, registros):
        super().__init__()
        self.registros = registros

    def extraer(self, desde):
        return [r for r in self.registros if desde is None or r.instante > desde]


class ConectorQueFalla(ConectorMediciones):
    def extraer(self, desde):
        raise ConnectionError("la fuente no responde")


@pytest.fixture
def sesion():
    motor = create_engine(URL)
    with motor.begin() as c:
        c.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    Base.metadata.drop_all(motor)
    Base.metadata.create_all(motor)
    s = sessionmaker(bind=motor, expire_on_commit=False)()
    s.add_all([Parametro(codigo="PM25", nombre="PM2.5", unidad="µg/m³", variable="calidad_aire"),
               Fuente(nombre="buena", tipo_api="prueba", url_base="-", activa=True, frecuencia_min=60),
               Fuente(nombre="caida", tipo_api="prueba", url_base="-", activa=True, frecuencia_min=60)])
    s.commit()
    yield s
    s.close()


def test_repetir_la_ingesta_no_duplica_datos(sesion, monkeypatch):
    registros = [_registro(1, 10.0), _registro(2, None, "faltante")]
    monkeypatch.setitem(ejecutor.CONECTORES, "buena", lambda: ConectorFijo(registros))
    fuente = sesion.scalar(select(Fuente).where(Fuente.nombre == "buena"))
    primera = ejecutor.ejecutar_fuente(sesion, fuente, completa=True)
    segunda = ejecutor.ejecutar_fuente(sesion, fuente, completa=True)
    assert (primera.estado, primera.registros) == ("correcta", 2)
    assert (segunda.estado, segunda.registros) == ("correcta", 0)
    assert sesion.scalar(select(func.count(Medicion.id))) == 2
    faltante = sesion.scalar(select(Medicion).where(Medicion.bandera == "faltante"))
    assert faltante.valor is None and faltante.ejecucion_id == primera.id  # procedencia original


def test_una_fuente_caida_no_afecta_a_las_demas(sesion, monkeypatch):
    monkeypatch.setitem(ejecutor.CONECTORES, "buena", lambda: ConectorFijo([_registro(1, 10.0)]))
    monkeypatch.setitem(ejecutor.CONECTORES, "caida", ConectorQueFalla)
    resultados = {sesion.get(Fuente, e.fuente_id).nombre: e for e in ejecutor.ejecutar_activas(sesion)}
    assert resultados["caida"].estado == "con_error"
    assert "la fuente no responde" in resultados["caida"].mensaje_error
    assert resultados["buena"].estado == "correcta"
    assert sesion.scalar(select(func.count(Medicion.id))) == 1


def test_genera_los_faltantes_implicitos_de_la_serie(sesion, monkeypatch):
    # La fuente publica las 01:00 y las 04:00, pero no las 02:00 ni las 03:00.
    monkeypatch.setitem(ejecutor.CONECTORES, "buena", lambda: ConectorFijo([_registro(1, 10.0), _registro(4, 12.0)]))
    fuente = sesion.scalar(select(Fuente).where(Fuente.nombre == "buena"))
    ejecucion = ejecutor.ejecutar_fuente(sesion, fuente)
    assert ejecucion.registros == 4 and "2 faltantes implícitos" in ejecucion.mensaje_error
    horas = sesion.execute(select(Medicion.instante, Medicion.bandera).order_by(Medicion.instante)).all()
    assert [(h.hour, b) for h, b in horas] == [(1, "valido"), (2, "faltante"), (3, "faltante"), (4, "valido")]
    assert ejecutor.ejecutar_fuente(sesion, fuente, completa=True).registros == 0  # no duplica


def test_la_ingesta_incremental_solo_trae_datos_nuevos(sesion, monkeypatch):
    registros = [_registro(1, 10.0)]
    monkeypatch.setitem(ejecutor.CONECTORES, "buena", lambda: ConectorFijo(registros))
    fuente = sesion.scalar(select(Fuente).where(Fuente.nombre == "buena"))
    ejecutor.ejecutar_fuente(sesion, fuente)
    registros.append(_registro(2, 12.0))
    segunda = ejecutor.ejecutar_fuente(sesion, fuente)
    assert segunda.registros == 1
