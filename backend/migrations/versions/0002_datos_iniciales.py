"""datos iniciales: fuentes, parametros y valores guia de la OMS

Los puntos de corte del ICA (Resolucion 2254 de 2017, Tabla 6) se cargan en
el incremento 2, despues de verificarlos contra el texto oficial
(ver docs/bitacora.md).

Revision ID: 0002_datos_iniciales
Revises: 2a2aa756f389
"""
import sqlalchemy as sa
from alembic import op

revision = "0002_datos_iniciales"
down_revision = "2a2aa756f389"
branch_labels = None
depends_on = None

FUENTES = [
    # nombre, tipo_api, url_base, activa, frecuencia_min
    ("IDEAM - datos.gov.co", "Socrata", "https://www.datos.gov.co/resource/g4t8-zkc3.json", True, 1440),
    ("Datos Abiertos de Cali (DAGMA)", "CKAN", "https://datos.cali.gov.co/api/3/action", True, 10080),
    ("IDESC (capas territoriales)", "WFS", "https://ws-idesc.cali.gov.co/geoserver/wfs", True, 43200),
    # Pendientes: SATIC requiere autorizacion de la Secretaria de Gestion del
    # Riesgo y OpenAQ requiere una clave de API.
    ("SATIC (red OAC22)", "REST (no documentada)", "https://satic.cali.gov.co:9090/api", False, 60),
    ("OpenAQ", "REST", "https://api.openaq.org/v3", False, 60),
]

PARAMETROS = [
    # codigo, nombre, unidad, variable
    ("PM25", "PM2.5", "µg/m³", "calidad_aire"),
    ("PM10", "PM10", "µg/m³", "calidad_aire"),
]

# Guias de calidad del aire de la OMS (2021), promedio de 24 horas y anual.
GUIAS_OMS = [
    ("PM25", "Guía OMS 2021", "24 horas", None, 15),
    ("PM25", "Guía OMS 2021", "Anual", None, 5),
    ("PM10", "Guía OMS 2021", "24 horas", None, 45),
    ("PM10", "Guía OMS 2021", "Anual", None, 15),
]


def upgrade():
    fuente = sa.table("fuente", sa.column("nombre"), sa.column("tipo_api"),
                      sa.column("url_base"), sa.column("activa"), sa.column("frecuencia_min"))
    op.bulk_insert(fuente, [dict(zip(("nombre", "tipo_api", "url_base", "activa", "frecuencia_min"), f, strict=False))
                            for f in FUENTES])
    parametro = sa.table("parametro", sa.column("codigo"), sa.column("nombre"),
                         sa.column("unidad"), sa.column("variable"))
    op.bulk_insert(parametro, [dict(zip(("codigo", "nombre", "unidad", "variable"), p, strict=False))
                               for p in PARAMETROS])
    for codigo, referencia, categoria, inferior, superior in GUIAS_OMS:
        op.execute(sa.text(
            "INSERT INTO umbral_referencia (parametro_id, referencia, categoria, limite_inferior, limite_superior) "
            "SELECT id, :r, :c, :i, :s FROM parametro WHERE codigo = :p"
        ).bindparams(r=referencia, c=categoria, i=inferior, s=superior, p=codigo))


def downgrade():
    op.execute("DELETE FROM umbral_referencia")
    op.execute("DELETE FROM parametro")
    op.execute("DELETE FROM fuente")
