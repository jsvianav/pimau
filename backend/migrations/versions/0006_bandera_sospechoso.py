"""Bandera sospechoso para las rachas de un mismo valor

Un sensor detenido repite el mismo valor hora tras hora. El conector de SATIC
marca desde ahora esas horas como sospechosas (normalizacion.horas_constantes),
y esta migracion agrega la bandera y marca las rachas que ya estaban cargadas
como validas. Solo se revisa SATIC, que es la fuente donde se encontro el
problema; las series historicas del portal de Cali y del IDEAM se revisaran en
la analitica del Semestre 8 (RF-13).

Revision ID: 0006_bandera_sospechoso
Revises: 0005_fuente_satic
"""
from alembic import op

revision = "0006_bandera_sospechoso"
down_revision = "0005_fuente_satic"
branch_labels = None
depends_on = None

# Mismos valores que normalizacion.HORAS_VALOR_CONSTANTE y SIN_CONTROL_CONSTANTE.
HORAS = 6


def upgrade():
    op.drop_constraint("medicion_bandera_check", "medicion", type_="check")
    op.create_check_constraint("medicion_bandera_check", "medicion",
                               "bandera IN ('valido', 'faltante', 'fuera_de_rango', 'sospechoso')")
    # Las horas consecutivas con el mismo valor comparten la diferencia entre
    # su instante y su posicion dentro de ese valor (islas y huecos).
    op.execute(f"""
        WITH serie AS (
            SELECT m.id, m.estacion_id, m.parametro_id, m.valor,
                   m.instante - row_number() OVER (PARTITION BY m.estacion_id, m.parametro_id, m.valor
                                                   ORDER BY m.instante) * interval '1 hour' AS grupo
            FROM medicion m
            JOIN estacion e ON e.id = m.estacion_id
            JOIN fuente f ON f.id = e.fuente_id
            JOIN parametro p ON p.id = m.parametro_id
            WHERE f.nombre = 'SATIC (red OAC22)' AND m.bandera = 'valido'
              AND p.codigo NOT IN ('LLUVIA', 'RAD')
        ), rachas AS (
            SELECT estacion_id, parametro_id, valor, grupo
            FROM serie GROUP BY estacion_id, parametro_id, valor, grupo
            HAVING count(*) >= {HORAS}
        )
        UPDATE medicion SET bandera = 'sospechoso'
        FROM serie JOIN rachas USING (estacion_id, parametro_id, valor, grupo)
        WHERE medicion.id = serie.id
    """)


def downgrade():
    op.execute("UPDATE medicion SET bandera = 'valido' WHERE bandera = 'sospechoso'")
    op.drop_constraint("medicion_bandera_check", "medicion", type_="check")
    op.create_check_constraint("medicion_bandera_check", "medicion",
                               "bandera IN ('valido', 'faltante', 'fuera_de_rango')")
