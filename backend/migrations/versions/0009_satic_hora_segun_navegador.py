"""Corrige de nuevo la hora de SATIC: depende de la zona del navegador

La migracion 0007 supuso que los archivos de SATIC estaban en UTC+2. Al
comparar el ciclo diario de temperatura de SATIC con el de las estaciones del
IDEAM (docs/bitacora.md, 2026-10-23) se encontro la causa real: SATIC guarda la
hora de Colombia como si fuera UTC y su pagina la muestra en la zona del
navegador. Por eso las mediciones cargadas quedaron con dos errores distintos:

- las de los archivos bajados con un navegador en hora de Colombia (la carga
  inicial de 30 dias, antes de las 20:00 UTC del 2026-10-21) quedaron 2 horas
  antes de su hora real;
- las de los archivos que bajo el descargador, cuyo navegador estaba en UTC,
  quedaron 3 horas despues.

Cuando las dos descargas vieron la misma hora, se conserva una sola fila: la
que tiene valor y, si ambas lo tienen, la del descargador. Las anomalias de
SATIC se borran y la analitica las vuelve a calcular.

Revision ID: 0009_satic_hora_segun_navegador
Revises: 0008_ruido_anomalias_alertas
"""
from alembic import op

revision = "0009_satic_hora_segun_navegador"
down_revision = "0008_ruido_anomalias_alertas"
branch_labels = None
depends_on = None

INICIO_DESCARGADOR = "2026-10-21 20:00+00"


def upgrade():
    op.execute(f"""
        CREATE TEMP TABLE satic_correccion AS
        SELECT m.id, m.estacion_id, m.parametro_id, m.valor,
               ej.inicio >= '{INICIO_DESCARGADOR}' AS del_descargador,
               CASE WHEN ej.inicio >= '{INICIO_DESCARGADOR}' THEN m.instante - interval '3 hours'
                    ELSE m.instante + interval '2 hours' END AS nuevo
        FROM medicion m
        JOIN ejecucion_ingesta ej ON ej.id = m.ejecucion_id
        JOIN estacion e ON e.id = m.estacion_id
        JOIN fuente f ON f.id = e.fuente_id
        WHERE f.nombre = 'SATIC (red OAC22)'
    """)
    # Filas que quedarian repetidas: se descarta la sin valor o, si las dos
    # tienen valor, la de la descarga manual.
    op.execute("""
        CREATE TEMP TABLE satic_descartar AS
        SELECT CASE WHEN c.valor IS NULL AND a.valor IS NOT NULL THEN c.id ELSE a.id END AS id
        FROM satic_correccion a
        JOIN satic_correccion c USING (estacion_id, parametro_id, nuevo)
        WHERE NOT a.del_descargador AND c.del_descargador
    """)
    op.execute("""DELETE FROM anomalia WHERE medicion_id IN (SELECT id FROM satic_correccion)""")
    op.execute("DELETE FROM medicion WHERE id IN (SELECT id FROM satic_descartar)")
    op.execute("""UPDATE medicion SET instante = instante + interval '100 years'
                  WHERE id IN (SELECT id FROM satic_correccion)""")
    op.execute("""UPDATE medicion m SET instante = c.nuevo FROM satic_correccion c
                  WHERE m.id = c.id AND c.id NOT IN (SELECT id FROM satic_descartar)""")
    op.execute("DROP TABLE satic_descartar")
    op.execute("DROP TABLE satic_correccion")


def downgrade():
    raise NotImplementedError("Esta corrección no se puede deshacer: descarta filas repetidas")
