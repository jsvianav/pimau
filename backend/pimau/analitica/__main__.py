"""Linea de comandos de la analitica.

    python -m pimau.analitica anomalias [--todo]   revisa las ultimas 48 horas (o toda la historia)
    python -m pimau.analitica ciclo [--cada 60]    repite la revision cada N minutos (servicio analitico)
"""
import argparse
import logging
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from pimau.analitica.ejecutor import revisar
from pimau.config import configuracion
from pimau.db.sesion import Sesion

log = logging.getLogger("pimau.analitica")
# Se revisan las ultimas 48 horas: cubre el retraso de SATIC y una ejecucion perdida.
HORAS_A_REVISAR = 48


def una_vez(todo: bool):
    inicio = time.monotonic()
    with Sesion() as sesion:
        nuevas = revisar(sesion, Path(configuracion.modelos_carpeta),
                         desde=datetime.now(UTC) - timedelta(hours=HORAS_A_REVISAR), todo=todo)
    log.info("Anomalías nuevas: %s (%.0f s)", nuevas, time.monotonic() - inicio)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    analizador = argparse.ArgumentParser(prog="pimau.analitica")
    sub = analizador.add_subparsers(dest="comando", required=True)
    sub.add_parser("anomalias").add_argument("--todo", action="store_true", help="Revisa toda la historia")
    sub.add_parser("ciclo").add_argument("--cada", type=int, default=60, help="Minutos entre revisiones")
    argumentos = analizador.parse_args()
    if argumentos.comando == "anomalias":
        una_vez(argumentos.todo)
        return
    while True:
        try:
            una_vez(todo=False)
        except Exception:
            log.exception("Falló la revisión de anomalías; se reintenta en la próxima ejecución")
        time.sleep(argumentos.cada * 60)


if __name__ == "__main__":
    main()
