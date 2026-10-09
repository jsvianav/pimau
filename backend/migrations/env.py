from alembic import context
from sqlalchemy import engine_from_config, pool

from pimau.config import configuracion
from pimau.db.modelos import Base

config = context.config
config.set_main_option("sqlalchemy.url", configuracion.database_url)
target_metadata = Base.metadata


def incluir_objeto(objeto, nombre, tipo, reflejado, comparado_con):
    # Las tablas de PostGIS y TIGER no son parte del modelo.
    if tipo == "table" and reflejado and comparado_con is None:
        return False
    return True


def ejecutar_migraciones():
    motor = engine_from_config(config.get_section(config.config_ini_section),
                               prefix="sqlalchemy.", poolclass=pool.NullPool)
    with motor.connect() as conexion:
        context.configure(connection=conexion, target_metadata=target_metadata,
                          include_object=incluir_objeto)
        with context.begin_transaction():
            context.run_migrations()


ejecutar_migraciones()
