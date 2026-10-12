"""Ejecucion de la ingesta de una fuente (RF-01, RF-04 y RF-11).

Cada fuente corre en su propia ejecucion y su propia transaccion. Si una
fuente falla, el error queda registrado y las demas siguen (escenario 6).
"""
import logging
from datetime import UTC, datetime
from itertools import islice

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from pimau.db.modelos import CapaTerritorial, EjecucionIngesta, Estacion, Fuente, Medicion, Parametro
from pimau.ingesta.conectores.base import ConectorCapas, ConectorMediciones
from pimau.ingesta.conectores.cali_ckan import ConectorCaliCkan
from pimau.ingesta.conectores.ideam import ConectorIdeam
from pimau.ingesta.conectores.idesc import ConectorIdesc

log = logging.getLogger("pimau.ingesta")

# Correspondencia entre cada fuente registrada y su conector.
CONECTORES = {
    "IDEAM - datos.gov.co": ConectorIdeam,
    "Datos Abiertos de Cali (DAGMA)": ConectorCaliCkan,
    "IDESC (capas territoriales)": ConectorIdesc,
}

TAMANO_LOTE = 5000


def _ahora():
    return datetime.now(UTC)


def _lotes(iterable, tamano):
    iterador = iter(iterable)
    while lote := list(islice(iterador, tamano)):
        yield lote


def ejecutar_fuente(sesion: Session, fuente: Fuente, completa: bool = False) -> EjecucionIngesta:
    """Ejecuta la ingesta de una fuente y devuelve el registro de la ejecucion."""
    ejecucion = EjecucionIngesta(fuente_id=fuente.id, inicio=_ahora(), estado="en_curso")
    sesion.add(ejecucion)
    sesion.commit()
    try:
        clase = CONECTORES.get(fuente.nombre)
        if clase is None:
            raise LookupError(f"La fuente '{fuente.nombre}' no tiene conector implementado")
        conector = clase()
        if isinstance(conector, ConectorMediciones):
            desde = None if completa else _ultimo_instante(sesion, fuente)
            registros = _cargar_mediciones(sesion, fuente, ejecucion, conector.extraer(desde))
            notas = []
            if conector.frecuencia_esperada is not None:
                faltantes = completar_faltantes(sesion, fuente, ejecucion, conector.frecuencia_esperada)
                registros += faltantes
                if faltantes:
                    notas.append(f"incluye {faltantes} faltantes implícitos")
            if conector.filas_descartadas:
                notas.append(f"Advertencia: {conector.filas_descartadas} filas descartadas "
                             "por fecha ilegible")
            ejecucion.mensaje_error = ". ".join(notas) or None
        elif isinstance(conector, ConectorCapas):
            registros = _cargar_capas(sesion, conector.extraer())
        else:
            raise TypeError(f"Conector no soportado: {clase.__name__}")
        ejecucion.estado = "correcta"
        ejecucion.registros = registros
    except Exception as error:  # el error se registra y no detiene las demas fuentes
        sesion.rollback()
        log.exception("Falló la ingesta de %s", fuente.nombre)
        ejecucion.estado = "con_error"
        ejecucion.mensaje_error = f"{type(error).__name__}: {error}"[:2000]
    ejecucion.fin = _ahora()
    sesion.add(ejecucion)
    sesion.commit()
    return ejecucion


def _ultimo_instante(sesion, fuente):
    return sesion.scalar(
        select(func.max(Medicion.instante))
        .join(Estacion, Medicion.estacion_id == Estacion.id)
        .where(Estacion.fuente_id == fuente.id))


def _cargar_mediciones(sesion, fuente, ejecucion, registros) -> int:
    parametros = {p.codigo: p.id for p in sesion.scalars(select(Parametro))}
    estaciones: dict[str, int] = {}
    insertadas = 0
    for lote in _lotes(registros, TAMANO_LOTE):
        filas = []
        for r in lote:
            if r.parametro not in parametros:
                continue
            if r.estacion.codigo not in estaciones:
                estaciones[r.estacion.codigo] = _asegurar_estacion(sesion, fuente, r.estacion)
            filas.append(dict(estacion_id=estaciones[r.estacion.codigo],
                              parametro_id=parametros[r.parametro],
                              ejecucion_id=ejecucion.id, instante=r.instante,
                              valor=r.valor, bandera=r.bandera,
                              fecha_publicacion=r.fecha_publicacion))
        if not filas:
            continue
        # Si una ingesta se repite, no duplica datos y conserva la procedencia original.
        resultado = sesion.execute(insert(Medicion).values(filas).on_conflict_do_nothing(
            index_elements=["estacion_id", "parametro_id", "instante"]).returning(Medicion.id))
        insertadas += len(resultado.all())
        sesion.commit()
    return insertadas


def completar_faltantes(sesion, fuente, ejecucion, frecuencia) -> int:
    """Genera como faltantes los instantes que la fuente no publico (RF-03).

    Algunas fuentes, como el IDEAM, no publican las horas sin medicion. Para
    que todas las series se traten igual, cada instante esperado entre la
    primera y la ultima medicion de una serie que no exista se guarda sin
    valor y con la bandera faltante. Repetirlo no duplica datos.
    """
    resultado = sesion.execute(text("""
        WITH series AS (
            SELECT m.estacion_id, m.parametro_id, min(m.instante) AS desde, max(m.instante) AS hasta
            FROM medicion m JOIN estacion e ON e.id = m.estacion_id
            WHERE e.fuente_id = :fuente
            GROUP BY m.estacion_id, m.parametro_id
        ), nuevas AS (
            INSERT INTO medicion (estacion_id, parametro_id, ejecucion_id, instante, valor, bandera)
            SELECT s.estacion_id, s.parametro_id, :ejecucion, g.instante, NULL, 'faltante'
            FROM series s
            CROSS JOIN LATERAL generate_series(s.desde, s.hasta, :frecuencia) AS g(instante)
            ON CONFLICT (estacion_id, parametro_id, instante) DO NOTHING
            RETURNING 1
        )
        SELECT count(*) FROM nuevas
    """), {"fuente": fuente.id, "ejecucion": ejecucion.id, "frecuencia": frecuencia})
    total = resultado.scalar_one()
    sesion.commit()
    return total


def _asegurar_estacion(sesion, fuente, estacion) -> int:
    punto = func.ST_SetSRID(func.ST_MakePoint(estacion.longitud, estacion.latitud), 4326)
    sentencia = insert(Estacion).values(
        fuente_id=fuente.id, codigo_origen=estacion.codigo, nombre=estacion.nombre,
        ubicacion=punto, activa=True,
    ).on_conflict_do_update(index_elements=["fuente_id", "codigo_origen"],
                            set_={"nombre": estacion.nombre, "ubicacion": punto}
    ).returning(Estacion.id)
    return sesion.execute(sentencia).scalar_one()


def _cargar_capas(sesion, registros) -> int:
    total = 0
    for r in registros:
        geometria = func.ST_Multi(func.ST_GeomFromText(r.geometria_wkt, 4326))
        sesion.execute(insert(CapaTerritorial).values(
            tipo=r.tipo, codigo=r.codigo, nombre=r.nombre, geometria=geometria,
        ).on_conflict_do_update(index_elements=["tipo", "codigo"],
                                set_={"nombre": r.nombre, "geometria": geometria}))
        total += 1
    sesion.commit()
    return total


def ejecutar_activas(sesion: Session, completa: bool = False) -> list[EjecucionIngesta]:
    fuentes = sesion.scalars(select(Fuente).where(Fuente.activa).order_by(Fuente.id)).all()
    return [ejecutar_fuente(sesion, f, completa) for f in fuentes]
