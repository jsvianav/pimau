"""Consultas de la capa de servicios. Solo leen la base de datos (ADR-01)."""
import json
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from pimau.api import ica

ZONA_COLOMBIA = ZoneInfo("America/Bogota")
REFERENCIA_ICA = "ICA Res. 2254 de 2017"
REFERENCIA_OMS = "Guía OMS 2021"


def parametros(sesion: Session) -> list[dict]:
    filas = sesion.execute(text("SELECT codigo, nombre, unidad, variable FROM parametro ORDER BY codigo"))
    return [dict(f._mapping) for f in filas]


def umbrales(sesion: Session) -> dict:
    """Puntos de corte del ICA y valores guia de la OMS, por parametro."""
    filas = sesion.execute(text("""
        SELECT p.codigo, u.referencia, u.categoria, u.limite_inferior, u.limite_superior, u.color
        FROM umbral_referencia u JOIN parametro p ON p.id = u.parametro_id
        ORDER BY p.codigo, u.referencia, u.limite_inferior NULLS FIRST
    """))
    resultado: dict = {}
    for f in filas:
        destino = resultado.setdefault(f.codigo, {"ica": [], "oms": {}})
        if f.referencia == REFERENCIA_ICA:
            destino["ica"].append({"categoria": f.categoria, "inferior": float(f.limite_inferior),
                                   "superior": float(f.limite_superior), "color": f.color})
        elif f.referencia == REFERENCIA_OMS:
            destino["oms"][f.categoria] = float(f.limite_superior)
    return resultado


def _cortes(umbrales_parametro: dict) -> list[ica.PuntoCorte]:
    return [ica.PuntoCorte(c["categoria"], c["inferior"], c["superior"], c["color"])
            for c in umbrales_parametro.get("ica", [])]


def estaciones(sesion: Session) -> dict:
    """GeoJSON de las estaciones con su ultimo estado por parametro (RF-05 y RF-07).

    Para cada estacion y parametro se devuelve:
    - la ultima medicion valida (valor horario y fecha);
    - el ICA del ultimo periodo de 24 horas representativo, es decir, con al
      menos MINIMO_HORAS_VALIDAS_24H horas validas (Res. 2254, art. 21, par. 3).
    Al final de muchas series hay pocos datos, por eso ese periodo puede ser
    anterior a la ultima medicion. La respuesta indica la fecha de cada uno.
    """
    limites = umbrales(sesion)
    filas = sesion.execute(text("""
        WITH ultima AS (
            SELECT DISTINCT ON (m.estacion_id, m.parametro_id)
                   m.estacion_id, m.parametro_id, m.instante, m.valor
            FROM medicion m
            WHERE m.bandera = 'valido'
            ORDER BY m.estacion_id, m.parametro_id, m.instante DESC
        ), ventanas AS (
            SELECT m.estacion_id, m.parametro_id, m.instante,
                   avg(m.valor) OVER w AS promedio, count(*) OVER w AS horas
            FROM medicion m
            WHERE m.bandera = 'valido'
            WINDOW w AS (PARTITION BY m.estacion_id, m.parametro_id ORDER BY m.instante
                         RANGE BETWEEN interval '23 hours' PRECEDING AND CURRENT ROW)
        ), representativa AS (
            SELECT DISTINCT ON (estacion_id, parametro_id) estacion_id, parametro_id, instante, promedio, horas
            FROM ventanas WHERE horas >= :minimo
            ORDER BY estacion_id, parametro_id, instante DESC
        )
        SELECT e.id, e.nombre, e.codigo_origen, f.nombre AS fuente,
               ST_X(e.ubicacion) AS lon, ST_Y(e.ubicacion) AS lat,
               p.codigo AS parametro, u.instante, u.valor,
               r.instante AS instante_ica, r.promedio, r.horas
        FROM estacion e
        JOIN fuente f ON f.id = e.fuente_id
        LEFT JOIN ultima u ON u.estacion_id = e.id
        LEFT JOIN parametro p ON p.id = u.parametro_id
        LEFT JOIN representativa r ON r.estacion_id = u.estacion_id AND r.parametro_id = u.parametro_id
        ORDER BY e.nombre, f.nombre, p.codigo
    """), {"minimo": ica.MINIMO_HORAS_VALIDAS_24H})
    elementos: dict[int, dict] = {}
    for f in filas:
        elemento = elementos.setdefault(f.id, {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [f.lon, f.lat]},
            "properties": {"id": f.id, "nombre": f.nombre, "codigo": f.codigo_origen,
                           "fuente": f.fuente, "parametros": {}},
        })
        if f.parametro is None:
            continue
        promedio = float(f.promedio) if f.promedio is not None else None
        resultado = ica.calcular(promedio, _cortes(limites.get(f.parametro, {})))
        elemento["properties"]["parametros"][f.parametro] = {
            "instante": f.instante.isoformat(),
            "valor_horario": float(f.valor),
            "instante_ica": f.instante_ica.isoformat() if f.instante_ica else None,
            "promedio_24h": round(promedio, 1) if promedio is not None else None,
            "horas_validas_24h": f.horas,
            "ica": resultado.valor if resultado else None,
            "categoria": resultado.categoria if resultado else None,
            "color": resultado.color if resultado else None,
            "guia_oms_24h": limites.get(f.parametro, {}).get("oms", {}).get("24 horas"),
        }
    return {"type": "FeatureCollection", "features": list(elementos.values())}


def estacion_existe(sesion: Session, estacion_id: int) -> dict | None:
    fila = sesion.execute(text("""
        SELECT e.id, e.nombre, f.nombre AS fuente FROM estacion e
        JOIN fuente f ON f.id = e.fuente_id WHERE e.id = :id
    """), {"id": estacion_id}).first()
    return dict(fila._mapping) if fila else None


def _limites_utc(desde: date, hasta: date) -> tuple[datetime, datetime]:
    """Convierte un rango de dias de Colombia en instantes UTC [inicio, fin)."""
    inicio = datetime.combine(desde, time(0), ZONA_COLOMBIA).astimezone(timezone.utc)
    fin = datetime.combine(hasta + timedelta(days=1), time(0), ZONA_COLOMBIA).astimezone(timezone.utc)
    return inicio, fin


def serie_horaria(sesion: Session, estacion_id: int, parametro: str, desde: date, hasta: date) -> list[dict]:
    inicio, fin = _limites_utc(desde, hasta)
    filas = sesion.execute(text("""
        SELECT m.instante, m.valor, m.bandera
        FROM medicion m JOIN parametro p ON p.id = m.parametro_id
        WHERE m.estacion_id = :e AND p.codigo = :p AND m.instante >= :i AND m.instante < :f
        ORDER BY m.instante
    """), {"e": estacion_id, "p": parametro, "i": inicio, "f": fin})
    return [{"instante": f.instante.isoformat(),
             "valor": float(f.valor) if f.valor is not None else None,
             "bandera": f.bandera} for f in filas]


def serie_diaria(sesion: Session, estacion_id: int, parametro: str, desde: date, hasta: date) -> list[dict]:
    """Promedio diario (dia de Colombia). Si el dia no tiene horas validas suficientes, queda vacio."""
    inicio, fin = _limites_utc(desde, hasta)
    filas = sesion.execute(text("""
        SELECT (m.instante AT TIME ZONE 'America/Bogota')::date AS dia,
               avg(m.valor) FILTER (WHERE m.bandera = 'valido') AS promedio,
               count(*) FILTER (WHERE m.bandera = 'valido') AS horas_validas
        FROM medicion m JOIN parametro p ON p.id = m.parametro_id
        WHERE m.estacion_id = :e AND p.codigo = :p AND m.instante >= :i AND m.instante < :f
        GROUP BY 1 ORDER BY 1
    """), {"e": estacion_id, "p": parametro, "i": inicio, "f": fin})
    resultado = []
    for f in filas:
        valido = f.horas_validas >= ica.MINIMO_HORAS_VALIDAS_24H
        resultado.append({"dia": f.dia.isoformat(),
                          "valor": round(float(f.promedio), 1) if valido else None,
                          "horas_validas": f.horas_validas,
                          "bandera": "valido" if valido else "faltante"})
    return resultado


def rango_disponible(sesion: Session, estacion_id: int, parametro: str) -> dict | None:
    fila = sesion.execute(text("""
        SELECT min(m.instante) AS desde, max(m.instante) AS hasta
        FROM medicion m JOIN parametro p ON p.id = m.parametro_id
        WHERE m.estacion_id = :e AND p.codigo = :p
    """), {"e": estacion_id, "p": parametro}).first()
    if fila is None or fila.desde is None:
        return None
    return {"desde": fila.desde.astimezone(ZONA_COLOMBIA).date().isoformat(),
            "hasta": fila.hasta.astimezone(ZONA_COLOMBIA).date().isoformat()}


TIPOS_CAPA = ("comuna", "barrio", "corregimiento")


def capa(sesion: Session, tipo: str) -> dict:
    """GeoJSON de una capa territorial, simplificada para el mapa (RF-09)."""
    filas = sesion.execute(text("""
        SELECT codigo, nombre, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geometria, 0.00005), 6) AS g
        FROM capa_territorial WHERE tipo = :t ORDER BY codigo
    """), {"t": tipo})
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": json.loads(f.g),
         "properties": {"codigo": f.codigo, "nombre": f.nombre, "tipo": tipo}} for f in filas]}
