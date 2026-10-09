from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from pimau.config import configuracion

motor = create_engine(configuracion.database_url, pool_pre_ping=True)
Sesion = sessionmaker(bind=motor, expire_on_commit=False)
