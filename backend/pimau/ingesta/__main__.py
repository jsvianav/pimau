"""Linea de comandos de la ingesta.

    python -m pimau.ingesta ejecutar [--fuente NOMBRE] [--completa]
    python -m pimau.ingesta programador
    python -m pimau.ingesta estado
"""
import argparse
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.blocking import BlockingScheduler
from sqlalchemy import func, select

from pimau.db.modelos import EjecucionIngesta, Estacion, Fuente, Medicion
from pimau.db.sesion import Sesion
from pimau.ingesta.ejecutor import ejecutar_activas, ejecutar_fuente


def comando_ejecutar(argumentos):
    with Sesion() as sesion:
        if argumentos.fuente:
            fuente = sesion.scalar(select(Fuente).where(Fuente.nombre == argumentos.fuente))
            if fuente is None:
                raise SystemExit(f"No existe la fuente '{argumentos.fuente}'")
            ejecuciones = [ejecutar_fuente(sesion, fuente, argumentos.completa)]
        else:
            ejecuciones = ejecutar_activas(sesion, argumentos.completa)
        for e in ejecuciones:
            print(f"fuente={e.fuente_id} estado={e.estado} registros={e.registros} "
                  f"error={e.mensaje_error or '-'}")


def comando_programador(_):
    """Programa cada fuente activa segun su propia frecuencia (frecuencia_min)."""
    programador = BlockingScheduler(timezone="UTC")
    with Sesion() as sesion:
        fuentes = sesion.scalars(select(Fuente).where(Fuente.activa)).all()
    for fuente in fuentes:
        def trabajo(fuente_id=fuente.id):
            with Sesion() as s:
                f = s.get(Fuente, fuente_id)
                if f is not None and f.activa:
                    ejecutar_fuente(s, f)
        programador.add_job(trabajo, "interval", minutes=fuente.frecuencia_min,
                            next_run_time=datetime.now(timezone.utc), id=f"fuente-{fuente.id}")
        logging.info("Programada %s cada %s minutos", fuente.nombre, fuente.frecuencia_min)
    programador.start()


def comando_estado(_):
    """Resumen del estado de la ingesta por fuente (base del panel de RF-11)."""
    with Sesion() as sesion:
        for fuente in sesion.scalars(select(Fuente).order_by(Fuente.id)):
            ultima = sesion.scalar(select(EjecucionIngesta)
                                   .where(EjecucionIngesta.fuente_id == fuente.id)
                                   .order_by(EjecucionIngesta.inicio.desc()).limit(1))
            mediciones = sesion.scalar(select(func.count(Medicion.id))
                                       .join(Estacion, Medicion.estacion_id == Estacion.id)
                                       .where(Estacion.fuente_id == fuente.id))
            resumen = (f"{ultima.inicio:%Y-%m-%d %H:%M} {ultima.estado} ({ultima.registros} registros)"
                       if ultima else "sin ejecuciones")
            print(f"{'activa ' if fuente.activa else 'inactiva'} | {fuente.nombre:<32} | "
                  f"{mediciones:>9} mediciones | última: {resumen}")


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    analizador = argparse.ArgumentParser(prog="pimau.ingesta")
    sub = analizador.add_subparsers(required=True)
    p = sub.add_parser("ejecutar", help="Ejecuta la ingesta una vez")
    p.add_argument("--fuente", help="Nombre de la fuente; por defecto, todas las activas")
    p.add_argument("--completa", action="store_true", help="Descarga todo el histórico")
    p.set_defaults(funcion=comando_ejecutar)
    sub.add_parser("programador", help="Ejecuta las fuentes según su frecuencia").set_defaults(funcion=comando_programador)
    sub.add_parser("estado", help="Muestra el estado de la ingesta").set_defaults(funcion=comando_estado)
    argumentos = analizador.parse_args()
    argumentos.funcion(argumentos)


if __name__ == "__main__":
    main()
