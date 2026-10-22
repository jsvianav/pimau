"""Regla del ADR-01: las capas de servicios, analitica e ingesta no se llaman
entre si y solo comparten la base de datos (pimau.db)."""
import ast
from pathlib import Path

import pytest

PAQUETE = Path(__file__).resolve().parent.parent / "pimau"
CAPAS = ("api", "ingesta", "analitica")


def _imports(modulo: Path) -> set[str]:
    nombres = set()
    for nodo in ast.walk(ast.parse(modulo.read_text())):
        if isinstance(nodo, ast.Import):
            nombres.update(a.name for a in nodo.names)
        elif isinstance(nodo, ast.ImportFrom) and nodo.module:
            nombres.add(nodo.module)
    return nombres


@pytest.mark.parametrize("capa", CAPAS)
def test_una_capa_no_importa_a_las_demas(capa):
    carpeta = PAQUETE / capa
    if not carpeta.exists():
        pytest.skip(f"La capa {capa} todavía no existe")
    prohibidos = {f"pimau.{otra}" for otra in CAPAS if otra != capa}
    for modulo in carpeta.rglob("*.py"):
        for nombre in _imports(modulo):
            assert not any(nombre == p or nombre.startswith(p + ".") for p in prohibidos), \
                f"{modulo.relative_to(PAQUETE)} importa {nombre}, que pertenece a otra capa"


def test_la_api_conoce_las_mismas_fuentes_con_conector_que_la_ingesta():
    # La API no importa la ingesta (ADR-01), así que repite la lista; esta prueba
    # evita que las dos se separen al agregar un conector.
    from pimau.api.admin import FUENTES_CON_CONECTOR
    from pimau.ingesta.ejecutor import CONECTORES
    assert FUENTES_CON_CONECTOR == set(CONECTORES)
