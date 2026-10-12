"""puntos de corte del ICA (Resolucion 2254 de 2017, Tabla 6)

Valores verificados el 2026-10-09 contra la imagen de la Tabla 6 publicada en
el texto oficial de la norma (Secretaria Juridica Distrital de Bogota,
norma 82634). Concentraciones en µg/m³, promedio de 24 horas.

La norma nombra los colores (verde, amarillo, naranja, rojo, purpura y
marron). Los codigos hexadecimales son una eleccion de diseño de la
plataforma.

Revision ID: 0003_puntos_corte_ica
Revises: 0002_datos_iniciales
"""
import sqlalchemy as sa
from alembic import op

revision = "0003_puntos_corte_ica"
down_revision = "0002_datos_iniciales"
branch_labels = None
depends_on = None

REFERENCIA = "ICA Res. 2254 de 2017"

CATEGORIAS = [
    # categoria, color, PM10 (inferior, superior), PM2.5 (inferior, superior)
    ("Buena", "#00E400", (0, 54), (0, 12)),
    ("Aceptable", "#FFFF00", (55, 154), (13, 37)),
    ("Dañina a la salud de grupos sensibles", "#FF7E00", (155, 254), (38, 55)),
    ("Dañina a la salud", "#FF0000", (255, 354), (56, 150)),
    ("Muy dañina a la salud", "#8F3F97", (355, 424), (151, 250)),
    ("Peligrosa", "#7E0023", (425, 604), (251, 500)),
]


def upgrade():
    for categoria, color, pm10, pm25 in CATEGORIAS:
        for codigo, (inferior, superior) in (("PM10", pm10), ("PM25", pm25)):
            op.execute(sa.text(
                "INSERT INTO umbral_referencia (parametro_id, referencia, categoria, "
                "limite_inferior, limite_superior, color) "
                "SELECT id, :r, :c, :i, :s, :color FROM parametro WHERE codigo = :p"
            ).bindparams(r=REFERENCIA, c=categoria, i=inferior, s=superior, color=color, p=codigo))


def downgrade():
    op.execute(sa.text("DELETE FROM umbral_referencia WHERE referencia = :r").bindparams(r=REFERENCIA))
