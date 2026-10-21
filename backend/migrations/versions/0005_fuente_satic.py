"""SATIC (red OAC22) como fuente de datos recientes por archivos exportados

SATIC no ofrece una API pública, pero su geoportal deja descargar los últimos
30 días de cada variable de cada estación en Excel. La fuente se activa y pasa
a leer esos archivos desde la bandeja de entrada (conector satic.py).

Revision ID: 0005_fuente_satic
Revises: 0004_meteorologia_contaminantes
"""
from alembic import op

revision = "0005_fuente_satic"
down_revision = "0004_meteorologia_contaminantes"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        UPDATE fuente
        SET tipo_api = 'Archivos exportados (Excel)', url_base = 'https://satic.cali.gov.co',
            activa = true, frecuencia_min = 60
        WHERE nombre = 'SATIC (red OAC22)'
    """)


def downgrade():
    op.execute("""
        UPDATE fuente
        SET tipo_api = 'REST (no documentada)', url_base = 'https://satic.cali.gov.co:9090/api',
            activa = false, frecuencia_min = 60
        WHERE nombre = 'SATIC (red OAC22)'
    """)
