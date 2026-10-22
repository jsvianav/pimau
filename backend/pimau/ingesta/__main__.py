"""Linea de comandos de la ingesta.

    python -m pimau.ingesta ejecutar [--fuente NOMBRE] [--completa]
    python -m pimau.ingesta programador
    python -m pimau.ingesta estado
"""
import argparse
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

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


def fuentes_pendientes(sesion, ahora: datetime) -> list[Fuente]:
    """Fuentes activas cuya ultima ejecucion empezo hace al menos su frecuencia.

    Se consulta en cada revision, asi que activar, desactivar o cambiar la
    frecuencia de una fuente desde el panel (RF-10) se aplica en la siguiente
    ejecucion sin reiniciar el programador.
    """
    ultimas = dict(sesion.execute(select(EjecucionIngesta.fuente_id, func.max(EjecucionIngesta.inicio))
                                  .group_by(EjecucionIngesta.fuente_id)).all())
    return [f for f in sesion.scalars(select(Fuente).where(Fuente.activa).order_by(Fuente.id))
            if f.id not in ultimas or ahora - ultimas[f.id] >= timedelta(minutes=f.frecuencia_min)]


def _ejecutar_por_id(fuente_id: int):
    with Sesion() as sesion:
        fuente = sesion.get(Fuente, fuente_id)
        if fuente is not None and fuente.activa:
            ejecutar_fuente(sesion, fuente)


def comando_programador(_):
    """Revisa cada minuto que fuentes toca ejecutar, cada una en su propio hilo
    para que una fuente lenta no retrase a las demas."""
    en_curso: dict[int, object] = {}
    with ThreadPoolExecutor(max_workers=4, thread_name_prefix="fuente") as hilos:
        while True:
            with Sesion() as sesion:
                for fuente in fuentes_pendientes(sesion, datetime.now(UTC)):
                    if fuente.id in en_curso and not en_curso[fuente.id].done():
                        continue
                    logging.info("Ejecutando %s (cada %s minutos)", fuente.nombre, fuente.frecuencia_min)
                    en_curso[fuente.id] = hilos.submit(_ejecutar_por_id, fuente.id)
            time.sleep(60)


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
    programador = sub.add_parser("programador", help="Ejecuta las fuentes según su frecuencia")
    programador.set_defaults(funcion=comando_programador)
    sub.add_parser("estado", help="Muestra el estado de la ingesta").set_defaults(funcion=comando_estado)
    argumentos = analizador.parse_args()
    argumentos.funcion(argumentos)


if __name__ == "__main__":
    main()
