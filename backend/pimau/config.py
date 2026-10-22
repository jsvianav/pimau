from pydantic_settings import BaseSettings


class Configuracion(BaseSettings):
    database_url: str = "postgresql+psycopg://pimau:pimau@localhost:5432/pimau"
    openaq_api_key: str = ""
    zona_horaria_fuentes: str = "America/Bogota"
    # Carpeta donde el administrador deja los archivos exportados de SATIC.
    satic_bandeja: str = "/datos/satic"
    # Zona de las horas de los archivos de SATIC. No es la de Colombia: en los
    # 69 archivos descargados el 2026-10-22, la ultima lectura iba dos horas
    # por delante de la hora UTC de la descarga, es decir, UTC+2 (siete horas
    # por delante de Colombia). Se usa un desfase fijo porque no se sabe si la
    # plataforma cambia de horario en invierno; si lo hace, el conector descarta
    # las lecturas que queden en el futuro y lo advierte (conectores/satic.py).
    satic_zona_horaria: str = "Etc/GMT-2"


configuracion = Configuracion()
