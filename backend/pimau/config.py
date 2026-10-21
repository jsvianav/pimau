from pydantic_settings import BaseSettings


class Configuracion(BaseSettings):
    database_url: str = "postgresql+psycopg://pimau:pimau@localhost:5432/pimau"
    openaq_api_key: str = ""
    zona_horaria_fuentes: str = "America/Bogota"
    # Carpeta donde el administrador deja los archivos exportados de SATIC.
    satic_bandeja: str = "/datos/satic"


configuracion = Configuracion()
