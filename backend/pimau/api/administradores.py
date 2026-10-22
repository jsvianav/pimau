"""Gestion de las cuentas de administrador desde la linea de comandos.

    python -m pimau.api.administradores crear --correo admin@ejemplo.org
    python -m pimau.api.administradores desactivar --correo admin@ejemplo.org
    python -m pimau.api.administradores listar

Las cuentas no se crean desde la web: asi la API no ofrece ninguna ruta para
crear administradores que un atacante pudiera usar. La contrasena se pide por
teclado sin mostrarla, o se toma de la variable PIMAU_CLAVE_NUEVA cuando el
comando corre sin terminal (por ejemplo, en un script de despliegue).
"""
import argparse
import getpass
import os

from sqlalchemy import select

from pimau.api.seguridad import LONGITUD_MINIMA_CLAVE, cifrar_clave
from pimau.db.modelos import Administrador
from pimau.db.sesion import Sesion


def _pedir_clave() -> str:
    if clave := os.environ.get("PIMAU_CLAVE_NUEVA"):
        return clave
    clave = getpass.getpass(f"Contraseña (mínimo {LONGITUD_MINIMA_CLAVE} caracteres): ")
    if clave != getpass.getpass("Repita la contraseña: "):
        raise SystemExit("Las contraseñas no coinciden")
    return clave


def crear(correo: str):
    correo = correo.strip().lower()
    with Sesion() as sesion:
        existente = sesion.scalar(select(Administrador).where(Administrador.correo == correo))
        try:
            hash_clave = cifrar_clave(_pedir_clave())
        except ValueError as error:
            raise SystemExit(str(error)) from error
        if existente:
            existente.hash_clave, existente.activo = hash_clave, True
            print(f"Se cambió la contraseña de {correo} y la cuenta quedó activa")
        else:
            sesion.add(Administrador(correo=correo, hash_clave=hash_clave, activo=True))
            print(f"Se creó el administrador {correo}")
        sesion.commit()


def desactivar(correo: str):
    with Sesion() as sesion:
        correo = correo.strip().lower()
        administrador = sesion.scalar(select(Administrador).where(Administrador.correo == correo))
        if administrador is None:
            raise SystemExit(f"No existe el administrador {correo}")
        administrador.activo = False
        sesion.commit()
        print(f"Se desactivó {correo}; sus sesiones abiertas dejan de funcionar")


def listar():
    with Sesion() as sesion:
        for a in sesion.scalars(select(Administrador).order_by(Administrador.id)):
            print(f"{'activo  ' if a.activo else 'inactivo'} {a.correo}")


def main():
    analizador = argparse.ArgumentParser(prog="pimau.api.administradores")
    sub = analizador.add_subparsers(dest="comando", required=True)
    for nombre in ("crear", "desactivar"):
        sub.add_parser(nombre).add_argument("--correo", required=True)
    sub.add_parser("listar")
    argumentos = analizador.parse_args()
    if argumentos.comando == "crear":
        crear(argumentos.correo)
    elif argumentos.comando == "desactivar":
        desactivar(argumentos.correo)
    else:
        listar()


if __name__ == "__main__":
    main()
