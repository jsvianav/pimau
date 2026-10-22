"""Autenticacion del administrador y registro de auditoria (ADR-05, escenario 4).

- Las contrasenas se guardan con Argon2, un algoritmo pensado para contrasenas.
- La sesion es un token JWT firmado de corta duracion. La API no guarda
  sesiones: cada solicitud trae su token y se verifica.
- Las rutas de administracion niegan el acceso por defecto (STRIDE, elevacion
  de privilegios): sin un token valido responden 401 y el intento queda en el
  registro de auditoria.
- Despues de varios intentos fallidos, el inicio de sesion se bloquea un tiempo
  para esa direccion IP y para ese correo (STRIDE, suplantacion).
"""
import ipaddress
import logging
import secrets
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from pimau.config import configuracion
from pimau.db.modelos import Administrador, RegistroAuditoria
from pimau.db.sesion import sesion_bd

log = logging.getLogger("pimau.api")

MINUTOS_SESION = 30
INTENTOS_MAXIMOS = 5
VENTANA_INTENTOS_S = 15 * 60
LONGITUD_MINIMA_CLAVE = 12
ALGORITMO = "HS256"

_hasher = PasswordHasher()

# Si no se configura un secreto, se genera uno al arrancar: funciona, pero las
# sesiones abiertas se pierden cada vez que se reinicia la API.
_secreto = configuracion.jwt_secreto
if not _secreto:
    _secreto = secrets.token_urlsafe(48)
    log.warning("JWT_SECRETO no está configurado: se usa uno temporal")

# Hash de una clave cualquiera, para que verificar un correo inexistente tarde
# lo mismo que uno existente y no revele cuáles existen.
_HASH_DE_RELLENO = _hasher.hash(secrets.token_urlsafe(16))


def cifrar_clave(clave: str) -> str:
    if len(clave) < LONGITUD_MINIMA_CLAVE:
        raise ValueError(f"La contraseña debe tener al menos {LONGITUD_MINIMA_CLAVE} caracteres")
    return _hasher.hash(clave)


def _clave_correcta(hash_clave: str, clave: str) -> bool:
    try:
        return _hasher.verify(hash_clave, clave)
    except (VerificationError, InvalidHashError):
        return False


def ip_de(request: Request) -> str:
    """IP del cliente; si no es una direccion valida, 0.0.0.0 (la columna es de tipo inet)."""
    try:
        return str(ipaddress.ip_address(request.client.host))
    except (AttributeError, ValueError):
        return "0.0.0.0"


def auditar(sesion: Session, accion: str, resultado: str, ip: str, administrador_id: int | None = None):
    """Deja una accion en el registro de auditoria (STRIDE, repudio)."""
    sesion.add(RegistroAuditoria(administrador_id=administrador_id, accion=accion[:500],
                                 resultado=resultado, ip_origen=ip, instante=datetime.now(UTC)))
    sesion.commit()


# --- Intentos fallidos ---------------------------------------------------------
_fallos: dict[str, deque] = defaultdict(deque)


def _recientes(clave: str) -> deque:
    ventana = _fallos[clave]
    ahora = time.monotonic()
    while ventana and ahora - ventana[0] > VENTANA_INTENTOS_S:
        ventana.popleft()
    return ventana


def bloqueado(ip: str, correo: str) -> bool:
    return any(len(_recientes(c)) >= INTENTOS_MAXIMOS for c in (f"ip:{ip}", f"correo:{correo}"))


def registrar_fallo(ip: str, correo: str):
    for clave in (f"ip:{ip}", f"correo:{correo}"):
        _recientes(clave).append(time.monotonic())


def reiniciar_fallos():
    _fallos.clear()


# --- Sesion ----------------------------------------------------------------------
def iniciar_sesion(sesion: Session, correo: str, clave: str) -> Administrador | None:
    """Devuelve el administrador si el correo y la clave son correctos y la cuenta esta activa."""
    administrador = sesion.query(Administrador).filter(Administrador.correo == correo.strip().lower()).first()
    if administrador is None:
        _clave_correcta(_HASH_DE_RELLENO, clave)
        return None
    if not _clave_correcta(administrador.hash_clave, clave) or not administrador.activo:
        return None
    return administrador


def emitir_token(administrador: Administrador) -> tuple[str, datetime]:
    expira = datetime.now(UTC) + timedelta(minutes=MINUTOS_SESION)
    token = jwt.encode({"sub": str(administrador.id), "exp": expira}, _secreto, algorithm=ALGORITMO)
    return token, expira


_portador = HTTPBearer(auto_error=False)


def administrador_actual(request: Request,
                         credenciales: HTTPAuthorizationCredentials | None = Depends(_portador),
                         sesion: Session = Depends(sesion_bd)) -> Administrador:
    """Dependencia de todas las rutas de administracion: sin un token valido, 401."""
    administrador = None
    if credenciales is not None:
        try:
            datos = jwt.decode(credenciales.credentials, _secreto, algorithms=[ALGORITMO])
            administrador = sesion.get(Administrador, int(datos["sub"]))
        except (jwt.InvalidTokenError, KeyError, ValueError):
            administrador = None
    if administrador is None or not administrador.activo:
        auditar(sesion, f"Acceso a {request.method} {request.url.path}", "rechazado", ip_de(request))
        raise HTTPException(401, "Se requiere iniciar sesión como administrador",
                            headers={"WWW-Authenticate": "Bearer"})
    return administrador
