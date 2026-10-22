"""Modelo de datos común (ADR-02). Sigue el diagrama ER del Capítulo 3.

Las entidades del Semestre 8 (pronostico y anomalia) se agregan en el
incremento 4.
"""
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

BANDERAS = ("valido", "faltante", "fuera_de_rango", "sospechoso")
ESTADOS_EJECUCION = ("en_curso", "correcta", "con_error")


class Base(DeclarativeBase):
    pass


class Fuente(Base):
    __tablename__ = "fuente"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    nombre: Mapped[str] = mapped_column(Text, unique=True)
    tipo_api: Mapped[str] = mapped_column(Text)
    url_base: Mapped[str] = mapped_column(Text)
    activa: Mapped[bool] = mapped_column(Boolean, default=True)
    frecuencia_min: Mapped[int] = mapped_column(Integer)


class Estacion(Base):
    __tablename__ = "estacion"
    __table_args__ = (UniqueConstraint("fuente_id", "codigo_origen"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    fuente_id: Mapped[int] = mapped_column(ForeignKey("fuente.id"))
    codigo_origen: Mapped[str] = mapped_column(Text)
    nombre: Mapped[str] = mapped_column(Text)
    ubicacion = mapped_column(Geometry("POINT", srid=4326), nullable=False)
    activa: Mapped[bool] = mapped_column(Boolean, default=True)


class Parametro(Base):
    __tablename__ = "parametro"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    codigo: Mapped[str] = mapped_column(Text, unique=True)
    nombre: Mapped[str] = mapped_column(Text)
    unidad: Mapped[str] = mapped_column(Text)
    variable: Mapped[str] = mapped_column(Text)


class EjecucionIngesta(Base):
    __tablename__ = "ejecucion_ingesta"
    __table_args__ = (CheckConstraint(f"estado IN {ESTADOS_EJECUCION}"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    fuente_id: Mapped[int] = mapped_column(ForeignKey("fuente.id"))
    inicio: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    fin: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    estado: Mapped[str] = mapped_column(Text)
    registros: Mapped[int | None] = mapped_column(Integer)
    mensaje_error: Mapped[str | None] = mapped_column(Text)


class Medicion(Base):
    __tablename__ = "medicion"
    __table_args__ = (
        UniqueConstraint("estacion_id", "parametro_id", "instante"),
        CheckConstraint(f"bandera IN {BANDERAS}"),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    estacion_id: Mapped[int] = mapped_column(ForeignKey("estacion.id"))
    parametro_id: Mapped[int] = mapped_column(ForeignKey("parametro.id"))
    ejecucion_id: Mapped[int] = mapped_column(ForeignKey("ejecucion_ingesta.id"))
    instante: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    valor: Mapped[float | None] = mapped_column(Numeric)
    bandera: Mapped[str] = mapped_column(Text)
    fecha_publicacion: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UmbralReferencia(Base):
    __tablename__ = "umbral_referencia"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    parametro_id: Mapped[int] = mapped_column(ForeignKey("parametro.id"))
    referencia: Mapped[str] = mapped_column(Text)
    categoria: Mapped[str] = mapped_column(Text)
    limite_inferior: Mapped[float | None] = mapped_column(Numeric)
    limite_superior: Mapped[float | None] = mapped_column(Numeric)
    color: Mapped[str | None] = mapped_column(Text)


class CapaTerritorial(Base):
    __tablename__ = "capa_territorial"
    __table_args__ = (UniqueConstraint("tipo", "codigo"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tipo: Mapped[str] = mapped_column(Text)
    codigo: Mapped[str] = mapped_column(Text)
    nombre: Mapped[str] = mapped_column(Text)
    geometria = mapped_column(Geometry("MULTIPOLYGON", srid=4326), nullable=False)


class Administrador(Base):
    __tablename__ = "administrador"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    correo: Mapped[str] = mapped_column(Text, unique=True)
    hash_clave: Mapped[str] = mapped_column(Text)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)


class RegistroAuditoria(Base):
    __tablename__ = "registro_auditoria"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    administrador_id: Mapped[int | None] = mapped_column(ForeignKey("administrador.id"))
    accion: Mapped[str] = mapped_column(Text)
    resultado: Mapped[str] = mapped_column(Text)
    ip_origen: Mapped[str] = mapped_column(INET)
    instante: Mapped[datetime] = mapped_column(DateTime(timezone=True))
