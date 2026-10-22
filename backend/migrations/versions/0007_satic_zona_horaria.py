"""Corrige la hora de las mediciones de SATIC ya cargadas

Las horas de los archivos de SATIC estan en UTC+2, no en hora de Colombia
(configuracion.satic_zona_horaria). El conector las leia como hora de Colombia,
asi que cada medicion quedo guardada siete horas en el futuro. Los archivos de
la carga inicial de 30 dias ya fueron reemplazados por las descargas horarias,
asi que las mediciones se corrigen en la base en lugar de volver a cargarlas.

El cambio se hace en dos pasos para no chocar con la restriccion de unicidad
(estacion, parametro, instante): primero se llevan lejos en el tiempo, donde no
hay ninguna medicion, y despues a su hora correcta.

Revision ID: 0007_satic_zona_horaria
Revises: 0006_bandera_sospechoso
"""
from alembic import op

revision = "0007_satic_zona_horaria"
down_revision = "0006_bandera_sospechoso"
branch_labels = None
depends_on = None

_SATIC = """estacion_id IN (SELECT e.id FROM estacion e JOIN fuente f ON f.id = e.fuente_id
                               WHERE f.nombre = 'SATIC (red OAC22)')"""


def _mover(horas: int):
    op.execute(f"UPDATE medicion SET instante = instante + interval '100 years' WHERE {_SATIC}")
    op.execute(f"UPDATE medicion SET instante = instante - interval '100 years' + interval '{horas} hours' "
               f"WHERE {_SATIC}")


def upgrade():
    _mover(-7)


def downgrade():
    _mover(7)
