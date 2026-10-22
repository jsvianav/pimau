"""Ruido (RF-15), anomalias (RF-13) y umbrales de alerta (RF-14)

- Parametro RUIDO en dB(A), con la referencia de la Resolucion 627 de 2006,
  articulo 17, Tabla 2, para el sector B (zonas residenciales, universidades,
  colegios y parques urbanos): 65 dB(A) de dia y 50 de noche. Las estaciones de
  la red OAC22 estan sobre todo en universidades, colegios y zonas
  residenciales; el limite exacto depende del uso del suelo de cada sitio.
- Tabla anomalia, como en el modelo de datos del Capitulo 3: una fila por
  medicion senalada, con el metodo y su puntaje. Senalar no modifica el valor.
- Tabla umbral_alerta: un umbral configurable por parametro (RF-14).

Revision ID: 0008_ruido_anomalias_alertas
Revises: 0007_satic_zona_horaria
"""
import sqlalchemy as sa
from alembic import op

revision = "0008_ruido_anomalias_alertas"
down_revision = "0007_satic_zona_horaria"
branch_labels = None
depends_on = None

REFERENCIA_RUIDO = "Res. 627 de 2006, sector B"


def upgrade():
    op.execute("INSERT INTO parametro (codigo, nombre, unidad, variable) "
               "VALUES ('RUIDO', 'Ruido ambiental', 'dB(A)', 'ruido')")
    op.execute(f"""
        INSERT INTO umbral_referencia (parametro_id, referencia, categoria, limite_inferior, limite_superior, color)
        SELECT id, '{REFERENCIA_RUIDO}', c.categoria, NULL, c.valor, NULL
        FROM parametro, (VALUES ('Día', 65), ('Noche', 50)) AS c(categoria, valor)
        WHERE codigo = 'RUIDO'
    """)
    op.create_table(
        "anomalia",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("medicion_id", sa.BigInteger, sa.ForeignKey("medicion.id"), nullable=False, unique=True),
        sa.Column("metodo", sa.Text, nullable=False),
        sa.Column("puntaje", sa.Numeric, nullable=False),
        sa.Column("detectada_en", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "umbral_alerta",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("parametro_id", sa.Integer, sa.ForeignKey("parametro.id"), nullable=False, unique=True),
        sa.Column("valor", sa.Numeric, nullable=False),
        sa.Column("activo", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("actualizado", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table("umbral_alerta")
    op.drop_table("anomalia")
    op.execute(f"DELETE FROM umbral_referencia WHERE referencia = '{REFERENCIA_RUIDO}'")
    op.execute("DELETE FROM medicion WHERE parametro_id = (SELECT id FROM parametro WHERE codigo = 'RUIDO')")
    op.execute("DELETE FROM parametro WHERE codigo = 'RUIDO'")
