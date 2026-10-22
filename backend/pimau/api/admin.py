"""Rutas de administracion (incremento 3: RF-10 y RF-11).

Todas, salvo el inicio de sesion, exigen un token de administrador: la
dependencia se declara en el enrutador, asi que una ruta nueva queda protegida
sin tener que acordarse de hacerlo (acceso negado por defecto, STRIDE).
"""
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from pimau.api import consultas, esquemas, seguridad
from pimau.db.modelos import (
    Administrador,
    EjecucionIngesta,
    Fuente,
    Parametro,
    RegistroAuditoria,
    UmbralAlerta,
)
from pimau.db.sesion import sesion_bd

# Fuentes con conector implementado. Se repite aqui, en lugar de importar el
# ejecutor, para que la API no dependa de la capa de ingesta (ADR-01); la
# prueba de arquitectura revisa que coincida con la ingesta.
FUENTES_CON_CONECTOR = {
    "IDEAM - datos.gov.co",
    "Datos Abiertos de Cali (DAGMA)",
    "IDESC (capas territoriales)",
    "SATIC (red OAC22)",
}

publico = APIRouter(prefix="/api/admin", tags=["Administración"])
protegido = APIRouter(prefix="/api/admin", tags=["Administración"],
                      dependencies=[Depends(seguridad.administrador_actual)])


@publico.post("/sesion", summary="Iniciar sesión como administrador (RF-10)",
              response_model=esquemas.SesionAdmin)
def iniciar_sesion(datos: esquemas.Credenciales, request: Request, sesion: Session = Depends(sesion_bd)):
    ip = seguridad.ip_de(request)
    correo = datos.correo.strip().lower()
    if seguridad.bloqueado(ip, correo):
        seguridad.auditar(sesion, f"Inicio de sesión de {correo}", "bloqueado", ip)
        raise HTTPException(429, "Demasiados intentos fallidos. Intente de nuevo en 15 minutos.")
    administrador = seguridad.iniciar_sesion(sesion, correo, datos.clave)
    if administrador is None:
        seguridad.registrar_fallo(ip, correo)
        seguridad.auditar(sesion, f"Inicio de sesión de {correo}", "rechazado", ip)
        # El mismo mensaje para correo y clave: no revela qué correos existen.
        raise HTTPException(401, "El correo o la contraseña no son correctos")
    seguridad.auditar(sesion, "Inicio de sesión", "correcto", ip, administrador.id)
    token, expira = seguridad.emitir_token(administrador)
    return {"token": token, "expira": expira.isoformat(), "correo": administrador.correo}


def _ultimas_ejecuciones(sesion: Session) -> dict[int, dict]:
    filas = sesion.execute(text("""
        SELECT DISTINCT ON (fuente_id) fuente_id, inicio, fin, estado, registros, mensaje_error
        FROM ejecucion_ingesta ORDER BY fuente_id, inicio DESC
    """))
    return {f.fuente_id: _ejecucion(f) for f in filas}


def _ejecucion(f) -> dict:
    return {"inicio": f.inicio.isoformat(), "fin": f.fin.isoformat() if f.fin else None,
            "estado": f.estado, "registros": f.registros, "mensaje": f.mensaje_error}


def _fuente(fuente: Fuente, ultima: dict | None) -> dict:
    return {"id": fuente.id, "nombre": fuente.nombre, "tipo_api": fuente.tipo_api,
            "activa": fuente.activa, "frecuencia_min": fuente.frecuencia_min,
            "con_conector": fuente.nombre in FUENTES_CON_CONECTOR, "ultima_ejecucion": ultima}


@protegido.get("/fuentes", summary="Fuentes y estado de su ingesta (RF-11)",
               response_model=list[esquemas.FuenteAdmin])
def listar_fuentes(sesion: Session = Depends(sesion_bd)):
    ultimas = _ultimas_ejecuciones(sesion)
    return [_fuente(f, ultimas.get(f.id)) for f in sesion.scalars(select(Fuente).order_by(Fuente.id))]


@protegido.patch("/fuentes/{fuente_id}", response_model=esquemas.FuenteAdmin,
                 summary="Activar, desactivar o cambiar la frecuencia de una fuente (RF-10)")
def cambiar_fuente(fuente_id: int, cambios: esquemas.CambiosFuente, request: Request,
                   administrador: Administrador = Depends(seguridad.administrador_actual),
                   sesion: Session = Depends(sesion_bd)):
    fuente = sesion.get(Fuente, fuente_id)
    if fuente is None:
        raise HTTPException(404, "La fuente no existe")
    if cambios.activa and fuente.nombre not in FUENTES_CON_CONECTOR:
        raise HTTPException(409, "Esta fuente todavía no tiene conector, así que no se puede activar")
    detalle = []
    if cambios.activa is not None and cambios.activa != fuente.activa:
        detalle.append(f"activa {fuente.activa} → {cambios.activa}")
        fuente.activa = cambios.activa
    if cambios.frecuencia_min is not None and cambios.frecuencia_min != fuente.frecuencia_min:
        detalle.append(f"frecuencia {fuente.frecuencia_min} → {cambios.frecuencia_min} min")
        fuente.frecuencia_min = cambios.frecuencia_min
    sesion.commit()
    if detalle:
        seguridad.auditar(sesion, f"Cambio de {fuente.nombre}: {', '.join(detalle)}", "correcto",
                          seguridad.ip_de(request), administrador.id)
    return _fuente(fuente, _ultimas_ejecuciones(sesion).get(fuente.id))


@protegido.get("/ejecuciones", summary="Ejecuciones recientes de la ingesta (RF-11)",
               response_model=list[esquemas.EjecucionAdmin])
def listar_ejecuciones(fuente_id: int | None = None, solo_errores: bool = False,
                       limite: int = Query(20, ge=1, le=200), sesion: Session = Depends(sesion_bd)):
    consulta = select(EjecucionIngesta, Fuente.nombre).join(Fuente).order_by(EjecucionIngesta.inicio.desc())
    if fuente_id is not None:
        consulta = consulta.where(EjecucionIngesta.fuente_id == fuente_id)
    if solo_errores:
        consulta = consulta.where(EjecucionIngesta.estado == "con_error")
    return [{"fuente": nombre, **_ejecucion(e)} for e, nombre in sesion.execute(consulta.limit(limite))]


@protegido.get("/auditoria", summary="Registro de auditoría", response_model=list[esquemas.EventoAuditoria])
def listar_auditoria(limite: int = Query(30, ge=1, le=200), sesion: Session = Depends(sesion_bd)):
    consulta = (select(RegistroAuditoria, Administrador.correo)
                .outerjoin(Administrador, RegistroAuditoria.administrador_id == Administrador.id)
                .order_by(RegistroAuditoria.instante.desc()).limit(limite))
    return [{"instante": r.instante.isoformat(), "administrador": correo, "accion": r.accion,
             "resultado": r.resultado, "ip": str(r.ip_origen)} for r, correo in sesion.execute(consulta)]


@protegido.get("/umbrales", summary="Umbrales de alerta por parámetro (RF-14)",
               response_model=list[esquemas.UmbralAlerta])
def listar_umbrales(sesion: Session = Depends(sesion_bd)):
    return consultas.umbrales_alerta(sesion)


@protegido.put("/umbrales/{codigo}", summary="Configurar el umbral de alerta de un parámetro (RF-14)",
               response_model=esquemas.UmbralAlerta)
def configurar_umbral(codigo: str, cambio: esquemas.CambioUmbral, request: Request,
                      administrador: Administrador = Depends(seguridad.administrador_actual),
                      sesion: Session = Depends(sesion_bd)):
    parametro = sesion.scalar(select(Parametro).where(Parametro.codigo == codigo))
    if parametro is None:
        raise HTTPException(404, "El parámetro no existe")
    umbral = sesion.scalar(select(UmbralAlerta).where(UmbralAlerta.parametro_id == parametro.id))
    antes = f"{float(umbral.valor):g} {'activo' if umbral.activo else 'inactivo'}" if umbral else "sin umbral"
    if umbral is None:
        umbral = UmbralAlerta(parametro_id=parametro.id)
        sesion.add(umbral)
    umbral.valor, umbral.activo, umbral.actualizado = cambio.valor, cambio.activo, datetime.now(UTC)
    sesion.commit()
    despues = f"{cambio.valor:g} {'activo' if cambio.activo else 'inactivo'}"
    seguridad.auditar(sesion, f"Umbral de alerta de {codigo}: {antes} → {despues} {parametro.unidad}",
                      "correcto", seguridad.ip_de(request), administrador.id)
    return next(u for u in consultas.umbrales_alerta(sesion) if u["codigo"] == codigo)

