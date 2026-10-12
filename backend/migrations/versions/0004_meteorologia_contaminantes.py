"""meteorologia y otros contaminantes (cambio de alcance del 2026-10-10)

Agrega los contaminantes criterio O3, NO2, SO2 y CO, el sulfuro de hidrogeno y
las variables meteorologicas. Los puntos de corte del ICA se leyeron en la
Tabla 6 de la Resolucion 2254 de 2017 (imagen del texto oficial, norma 82634
de la Secretaria Juridica Distrital de Bogota). Cada contaminante usa su propio
tiempo de exposicion: CO y O3 de 8 horas, SO2 y NO2 de 1 hora.

Para el ozono se usa el ICA de 8 horas, que la norma pide reportar en general.
Por encima de 393 µg/m³ la norma exige el ICA de 1 hora; ese caso no se
calcula (ver docs/bitacora.md).

Valores guia de la OMS 2021 en µg/m³: O3 100 (8 horas), NO2 25 (24 horas) y 10
(anual), SO2 40 (24 horas) y CO 4000 (24 horas, 4 mg/m³).

Revision ID: 0004_meteorologia_contaminantes
Revises: 0003_puntos_corte_ica
"""
import sqlalchemy as sa
from alembic import op

revision = "0004_meteorologia_contaminantes"
down_revision = "0003_puntos_corte_ica"
branch_labels = None
depends_on = None

PARAMETROS = [
    # codigo, nombre, unidad, variable
    ("O3", "Ozono (O₃)", "µg/m³", "calidad_aire"),
    ("NO2", "Dióxido de nitrógeno (NO₂)", "µg/m³", "calidad_aire"),
    ("SO2", "Dióxido de azufre (SO₂)", "µg/m³", "calidad_aire"),
    ("CO", "Monóxido de carbono (CO)", "µg/m³", "calidad_aire"),
    ("H2S", "Sulfuro de hidrógeno (H₂S)", "µg/m³", "calidad_aire"),
    ("TEMP", "Temperatura", "°C", "meteorologia"),
    ("HUM", "Humedad relativa", "%", "meteorologia"),
    ("VV", "Velocidad del viento", "m/s", "meteorologia"),
    ("DV", "Dirección del viento", "°", "meteorologia"),
    ("LLUVIA", "Lluvia", "mm", "meteorologia"),
    ("RAD", "Radiación solar", "W/m²", "meteorologia"),
    ("PRES", "Presión atmosférica", "hPa", "meteorologia"),
]

REFERENCIA_ICA = "ICA Res. 2254 de 2017"
CATEGORIAS = [
    ("Buena", "#00E400"), ("Aceptable", "#FFFF00"),
    ("Dañina a la salud de grupos sensibles", "#FF7E00"), ("Dañina a la salud", "#FF0000"),
    ("Muy dañina a la salud", "#8F3F97"), ("Peligrosa", "#7E0023"),
]
CORTES = {
    "CO": [(0, 5094), (5095, 10819), (10820, 14254), (14255, 17688), (17689, 34862), (34863, 57703)],
    "SO2": [(0, 93), (94, 197), (198, 486), (487, 797), (798, 1583), (1584, 2629)],
    "NO2": [(0, 100), (101, 189), (190, 677), (678, 1221), (1222, 2349), (2350, 3853)],
    # Ozono de 8 horas: la categoria Peligrosa no tiene rango de 8 horas.
    "O3": [(0, 106), (107, 138), (139, 167), (168, 207), (208, 393)],
}

REFERENCIA_OMS = "Guía OMS 2021"
GUIAS_OMS = [
    ("O3", "8 horas", 100), ("NO2", "24 horas", 25), ("NO2", "Anual", 10),
    ("SO2", "24 horas", 40), ("CO", "24 horas", 4000),
]


def upgrade():
    parametro = sa.table("parametro", sa.column("codigo"), sa.column("nombre"),
                         sa.column("unidad"), sa.column("variable"))
    op.bulk_insert(parametro, [dict(zip(("codigo", "nombre", "unidad", "variable"), p, strict=False)) for p in PARAMETROS])
    insertar = sa.text(
        "INSERT INTO umbral_referencia (parametro_id, referencia, categoria, limite_inferior, limite_superior, color) "
        "SELECT id, :r, :c, :i, :s, :color FROM parametro WHERE codigo = :p")
    for codigo, cortes in CORTES.items():
        for (categoria, color), (inferior, superior) in zip(CATEGORIAS, cortes, strict=False):
            op.execute(insertar.bindparams(r=REFERENCIA_ICA, c=categoria, i=inferior, s=superior, color=color, p=codigo))
    for codigo, periodo, valor in GUIAS_OMS:
        op.execute(insertar.bindparams(r=REFERENCIA_OMS, c=periodo, i=None, s=valor, color=None, p=codigo))
    # Los nombres de PM se vuelven descriptivos, como los demas.
    op.execute("UPDATE parametro SET nombre = 'Material particulado PM2.5' WHERE codigo = 'PM25'")
    op.execute("UPDATE parametro SET nombre = 'Material particulado PM10' WHERE codigo = 'PM10'")


def downgrade():
    codigos = [p[0] for p in PARAMETROS]
    op.execute(sa.text("DELETE FROM umbral_referencia WHERE parametro_id IN "
                       "(SELECT id FROM parametro WHERE codigo = ANY(:c))").bindparams(c=codigos))
    op.execute(sa.text("DELETE FROM parametro WHERE codigo = ANY(:c)").bindparams(c=codigos))
    op.execute("UPDATE parametro SET nombre = 'PM2.5' WHERE codigo = 'PM25'")
    op.execute("UPDATE parametro SET nombre = 'PM10' WHERE codigo = 'PM10'")
