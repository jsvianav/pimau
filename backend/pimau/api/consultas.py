"""Consultas de la capa de servicios. Solo leen la base de datos (ADR-01)."""
import json
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from pimau.api import ica

ZONA_COLOMBIA = ZoneInfo("America/Bogota")
REFERENCIA_ICA = "ICA Res. 2254 de 2017"
REFERENCIA_OMS = "Guía OMS 2021"
REFERENCIA_RUIDO = "Res. 627 de 2006, sector B"


def parametros(sesion: Session) -> list[dict]:
    """Parametros con su unidad, su grupo y, si aplica, el tiempo de exposicion del ICA."""
    filas = sesion.execute(text("""
        SELECT p.codigo, p.nombre, p.unidad, p.variable,
               EXISTS (SELECT 1 FROM medicion m WHERE m.parametro_id = p.id) AS con_datos
        FROM parametro p ORDER BY p.variable, p.id
    """))
    return [{**dict(f._mapping), "ventana_ica_horas": ica.VENTANAS_HORAS.get(f.codigo)} for f in filas]


def codigos_parametros(sesion: Session) -> set[str]:
    return set(sesion.scalars(text("SELECT codigo FROM parametro")))


def umbrales(sesion: Session) -> dict:
    """Puntos de corte del ICA, valores guia de la OMS y limites de ruido, por parametro."""
    filas = sesion.execute(text("""
        SELECT p.codigo, u.referencia, u.categoria, u.limite_inferior, u.limite_superior, u.color
        FROM umbral_referencia u JOIN parametro p ON p.id = u.parametro_id
        ORDER BY p.codigo, u.referencia, u.limite_inferior NULLS FIRST
    """))
    resultado: dict = {}
    for f in filas:
        destino = resultado.setdefault(f.codigo, {"ica": [], "oms": {}, "ruido": {}})
        if f.referencia == REFERENCIA_ICA:
            destino["ica"].append({"categoria": f.categoria, "inferior": float(f.limite_inferior),
                                   "superior": float(f.limite_superior), "color": f.color})
        elif f.referencia == REFERENCIA_OMS:
            destino["oms"][f.categoria] = float(f.limite_superior)
        elif f.referencia == REFERENCIA_RUIDO:
            destino["ruido"][f.categoria] = float(f.limite_superior)
    return resultado


def _cortes(umbrales_parametro: dict) -> list[ica.PuntoCorte]:
    return [ica.PuntoCorte(c["categoria"], c["inferior"], c["superior"], c["color"])
            for c in umbrales_parametro.get("ica", [])]


def _guia_oms(guias: dict, horas: int | None) -> dict | None:
    """Valor guia de la OMS, preferiblemente del mismo periodo que el ICA."""
    if not guias:
        return None
    periodo = f"{horas} horas" if horas else None
    if periodo in guias:
        return {"periodo": periodo, "valor": guias[periodo], "comparable": True}
    clave = next((p for p in guias if p != "Anual"), next(iter(guias)))
    return {"periodo": clave, "valor": guias[clave], "comparable": False}


def estaciones(sesion: Session) -> dict:
    """GeoJSON de las estaciones con su ultimo estado por parametro (RF-05 y RF-07).

    Para cada estacion y parametro se devuelve la ultima medicion valida. Para
    los contaminantes con ICA se devuelve ademas el ICA del ultimo periodo
    representativo de su tiempo de exposicion (24, 8 o 1 hora), es decir, con
    al menos el 75 % de horas validas (Res. 2254, art. 21, par. 3). Al final de
    muchas series hay pocos datos, por eso ese periodo puede ser anterior a la
    ultima medicion. La respuesta indica la fecha de cada uno.
    """
    limites = umbrales(sesion)
    ventanas = ", ".join(f"('{c}', {h}, {ica.minimo_horas(c)})" for c, h in ica.VENTANAS_HORAS.items())
    filas = sesion.execute(text(f"""
        WITH config(codigo, horas, minimo) AS (VALUES {ventanas}),
        ultima AS (
            SELECT DISTINCT ON (m.estacion_id, m.parametro_id)
                   m.id, m.estacion_id, m.parametro_id, m.instante, m.valor
            FROM medicion m
            WHERE m.bandera = 'valido'
            ORDER BY m.estacion_id, m.parametro_id, m.instante DESC
        ), ventanas AS (
            SELECT m.estacion_id, m.parametro_id, m.instante, c.horas, c.minimo, m.valor,
                   avg(m.valor) OVER w24 AS prom24, count(*) OVER w24 AS n24,
                   avg(m.valor) OVER w8 AS prom8, count(*) OVER w8 AS n8
            FROM medicion m
            JOIN parametro p ON p.id = m.parametro_id
            JOIN config c ON c.codigo = p.codigo
            WHERE m.bandera = 'valido'
            WINDOW w24 AS (PARTITION BY m.estacion_id, m.parametro_id ORDER BY m.instante
                           RANGE BETWEEN interval '23 hours' PRECEDING AND CURRENT ROW),
                   w8 AS (PARTITION BY m.estacion_id, m.parametro_id ORDER BY m.instante
                          RANGE BETWEEN interval '7 hours' PRECEDING AND CURRENT ROW)
        ), elegidas AS (
            SELECT estacion_id, parametro_id, instante,
                   CASE horas WHEN 24 THEN prom24 WHEN 8 THEN prom8 ELSE valor END AS promedio,
                   CASE horas WHEN 24 THEN n24 WHEN 8 THEN n8 ELSE 1 END AS horas_validas,
                   minimo
            FROM ventanas
        ), representativa AS (
            SELECT DISTINCT ON (estacion_id, parametro_id)
                   estacion_id, parametro_id, instante, promedio, horas_validas
            FROM elegidas WHERE horas_validas >= minimo
            ORDER BY estacion_id, parametro_id, instante DESC
        ), marcada AS (
            -- Ultima medicion con valor que la ingesta marco como dudosa.
            SELECT DISTINCT ON (m.estacion_id, m.parametro_id)
                   m.estacion_id, m.parametro_id, m.instante, m.bandera
            FROM medicion m
            WHERE m.bandera IN ('sospechoso', 'fuera_de_rango')
            ORDER BY m.estacion_id, m.parametro_id, m.instante DESC
        ), anomalias_recientes AS (
            -- Anomalias de las ultimas 48 horas (RF-13).
            SELECT m.estacion_id, m.parametro_id, count(*) AS cantidad
            FROM anomalia a JOIN medicion m ON m.id = a.medicion_id
            WHERE m.instante > now() - interval '48 hours'
            GROUP BY 1, 2
        ), claves AS (
            SELECT estacion_id, parametro_id FROM ultima
            UNION SELECT estacion_id, parametro_id FROM marcada
        )
        SELECT e.id, e.nombre, e.codigo_origen, f.nombre AS fuente,
               ST_X(e.ubicacion) AS lon, ST_Y(e.ubicacion) AS lat,
               p.codigo AS parametro, u.instante, u.valor,
               r.instante AS instante_ica, r.promedio, r.horas_validas,
               d.instante AS instante_marcada, d.bandera AS bandera_marcada,
               coalesce(ar.cantidad, 0) AS anomalias_48h,
               EXISTS (SELECT 1 FROM anomalia a WHERE a.medicion_id = u.id) AS ultima_anomala
        FROM estacion e
        JOIN fuente f ON f.id = e.fuente_id
        LEFT JOIN claves k ON k.estacion_id = e.id
        LEFT JOIN parametro p ON p.id = k.parametro_id
        LEFT JOIN ultima u ON u.estacion_id = k.estacion_id AND u.parametro_id = k.parametro_id
        LEFT JOIN representativa r ON r.estacion_id = k.estacion_id AND r.parametro_id = k.parametro_id
        LEFT JOIN marcada d ON d.estacion_id = k.estacion_id AND d.parametro_id = k.parametro_id
        LEFT JOIN anomalias_recientes ar
               ON ar.estacion_id = k.estacion_id AND ar.parametro_id = k.parametro_id
        ORDER BY e.nombre, f.nombre, p.codigo
    """))
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
        horas = ica.VENTANAS_HORAS.get(f.parametro)
        promedio = float(f.promedio) if f.promedio is not None else None
        resultado = ica.calcular(promedio, _cortes(limites.get(f.parametro, {})),
                                 f.parametro in ica.SIN_CATEGORIA_SUPERIOR) if horas else None
        # Solo interesa la marca si es posterior al ultimo valor valido: indica
        # que las mediciones mas recientes no se pueden usar.
        marcada_reciente = f.instante_marcada and (f.instante is None or f.instante_marcada > f.instante)
        elemento["properties"]["parametros"][f.parametro] = {
            "instante": f.instante.isoformat() if f.instante else None,
            "valor_horario": float(f.valor) if f.valor is not None else None,
            "ventana_ica_horas": horas,
            "instante_ica": f.instante_ica.isoformat() if f.instante_ica else None,
            "promedio_ica": round(promedio, 1) if promedio is not None else None,
            "horas_validas_ica": f.horas_validas,
            "ica": resultado.valor if resultado else None,
            "categoria": resultado.categoria if resultado else None,
            "color": resultado.color if resultado else None,
            "guia_oms": _guia_oms(limites.get(f.parametro, {}).get("oms", {}), horas),
            "ultima_marcada": ({"instante": f.instante_marcada.isoformat(), "bandera": f.bandera_marcada}
                               if marcada_reciente else None),
            "anomalias_48h": f.anomalias_48h,
            "ultima_anomala": f.ultima_anomala,
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
    inicio = datetime.combine(desde, time(0), ZONA_COLOMBIA).astimezone(UTC)
    fin = datetime.combine(hasta + timedelta(days=1), time(0), ZONA_COLOMBIA).astimezone(UTC)
    return inicio, fin


def serie_horaria(sesion: Session, estacion_id: int, parametro: str, desde: date, hasta: date) -> list[dict]:
    inicio, fin = _limites_utc(desde, hasta)
    filas = sesion.execute(text("""
        SELECT m.instante, m.valor, m.bandera, a.puntaje
        FROM medicion m JOIN parametro p ON p.id = m.parametro_id
        LEFT JOIN anomalia a ON a.medicion_id = m.id
        WHERE m.estacion_id = :e AND p.codigo = :p AND m.instante >= :i AND m.instante < :f
        ORDER BY m.instante
    """), {"e": estacion_id, "p": parametro, "i": inicio, "f": fin})
    return [{"instante": f.instante.isoformat(),
             "valor": float(f.valor) if f.valor is not None else None,
             "bandera": f.bandera,
             "anomalia": f.puntaje is not None,
             "puntaje_anomalia": float(f.puntaje) if f.puntaje is not None else None} for f in filas]


# Como se resume un dia de cada parametro: la lluvia se suma, la direccion del
# viento se promedia como angulo (el promedio de 350° y 10° es 0°, no 180°) y el
# ruido por energia.
_AGREGACION_DIARIA = {
    "LLUVIA": "sum(m.valor) FILTER (WHERE m.bandera = 'valido')",
    # El ruido en decibeles se promedia por energia (nivel equivalente).
    "RUIDO": "10 * log(avg(power(10, m.valor / 10)) FILTER (WHERE m.bandera = 'valido'))",
    "DV": ("mod((degrees(atan2(avg(sin(radians(m.valor))) FILTER (WHERE m.bandera = 'valido'), "
           "avg(cos(radians(m.valor))) FILTER (WHERE m.bandera = 'valido'))))::numeric + 360, 360)"),
}
_PROMEDIO = "avg(m.valor) FILTER (WHERE m.bandera = 'valido')"


def serie_diaria(sesion: Session, estacion_id: int, parametro: str, desde: date, hasta: date) -> list[dict]:
    """Resumen diario (dia de Colombia). Si el dia no tiene horas validas suficientes, queda vacio."""
    inicio, fin = _limites_utc(desde, hasta)
    resumen = _AGREGACION_DIARIA.get(parametro, _PROMEDIO)
    filas = sesion.execute(text(f"""
        SELECT (m.instante AT TIME ZONE 'America/Bogota')::date AS dia,
               {resumen} AS promedio,
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


# --- Alertas (RF-14) ----------------------------------------------------------------
HORAS_ALERTA = 3  # una alerta esta activa si su medicion es de las ultimas 3 horas


def umbrales_alerta(sesion: Session) -> list[dict]:
    """Parametros con su umbral de alerta, si el administrador lo configuro."""
    filas = sesion.execute(text("""
        SELECT p.codigo, p.nombre, p.unidad, p.variable, u.valor, u.activo, u.actualizado
        FROM parametro p LEFT JOIN umbral_alerta u ON u.parametro_id = p.id
        WHERE p.variable IN ('calidad_aire', 'ruido') OR u.id IS NOT NULL
        ORDER BY p.variable, p.id
    """))
    return [{"codigo": f.codigo, "nombre": f.nombre, "unidad": f.unidad,
             "valor": float(f.valor) if f.valor is not None else None, "activo": bool(f.activo),
             "actualizado": f.actualizado.isoformat() if f.actualizado else None} for f in filas]


def alertas(estaciones_geojson: dict, umbrales: list[dict], ahora: datetime) -> list[dict]:
    """Estaciones cuya ultima medicion reciente iguala o supera el umbral de su parametro.

    Se calcula sobre el ultimo estado de las estaciones (el mismo del mapa), asi
    que no recorre la tabla de mediciones en cada consulta.
    """
    activos = {u["codigo"]: u for u in umbrales if u["activo"] and u["valor"] is not None}
    limite = ahora - timedelta(hours=HORAS_ALERTA)
    resultado = []
    for elemento in estaciones_geojson["features"]:
        propiedades = elemento["properties"]
        for codigo, estado in propiedades["parametros"].items():
            umbral = activos.get(codigo)
            if umbral is None or estado["instante"] is None or estado["valor_horario"] is None:
                continue
            if datetime.fromisoformat(estado["instante"]) < limite:
                continue
            # "Incluso si el valor es igual al limite" (criterio de RF-14, Anexo A).
            if estado["valor_horario"] >= umbral["valor"]:
                resultado.append({"estacion_id": propiedades["id"], "estacion": propiedades["nombre"],
                                  "fuente": propiedades["fuente"], "parametro": codigo,
                                  "nombre_parametro": umbral["nombre"], "unidad": umbral["unidad"],
                                  "valor": estado["valor_horario"], "umbral": umbral["valor"],
                                  "instante": estado["instante"]})
    return sorted(resultado, key=lambda a: (a["parametro"], -a["valor"]))

