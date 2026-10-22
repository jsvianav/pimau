from pydantic_settings import BaseSettings


class Configuracion(BaseSettings):
    database_url: str = "postgresql+psycopg://pimau:pimau@localhost:5432/pimau"
    openaq_api_key: str = ""
    zona_horaria_fuentes: str = "America/Bogota"
    # Carpeta donde el administrador deja los archivos exportados de SATIC.
    satic_bandeja: str = "/datos/satic"
    # Zona de las horas de los archivos de SATIC. SATIC guarda la hora de
    # Colombia como si fuera UTC, y su pagina la muestra en la zona del
    # navegador: en un navegador en hora de Colombia, la hora del archivo es la
    # hora UTC real. El descargador usa la zona de Colombia (descarga_satic.py),
    # igual que una descarga manual desde un computador en Colombia. Se verifico
    # comparando el ciclo diario de temperatura con el de las estaciones del IDEAM
    # (docs/bitacora.md, 2026-10-23). Si SATIC corrige su hora, el conector
    # descarta las lecturas que queden en el futuro y lo advierte.
    satic_zona_horaria: str = "UTC"
    # Carpeta donde la analitica guarda los modelos entrenados.
    modelos_carpeta: str = "/modelos"
    # Secreto con que se firman las sesiones del administrador (ADR-05).
    jwt_secreto: str = ""


configuracion = Configuracion()
