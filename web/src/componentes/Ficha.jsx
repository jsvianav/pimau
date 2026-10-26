import { useEffect, useState } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";
import { antiguedad, esReciente, fechaISO, formatearFecha, formatearNumero, nombreCorto, periodoRuido, restarDias,
         zonaDe } from "../util.js";
import { COLOR_ALERTA } from "./Mapa.jsx";

const RANGOS_INDICE = [[0, 50], [51, 100], [101, 150], [151, 200], [201, 300], [301, 500]];
const COLORES_ICA = ["#00E400", "#FFFF00", "#FF7E00", "#FF0000", "#8F3F97", "#7E0023"];

// Posición del marcador sobre seis segmentos iguales: cada categoría ocupa lo
// mismo, aunque sus rangos del índice no midan lo mismo.
function posicionEnEscala(ica) {
  const i = RANGOS_INDICE.findIndex(([, alto]) => ica <= alto);
  const [bajo, alto] = RANGOS_INDICE[i === -1 ? 5 : i];
  const fraccion = Math.min(1, Math.max(0, (ica - bajo) / (alto - bajo)));
  return { indice: i === -1 ? 5 : i, porcentaje: (((i === -1 ? 5 : i) + fraccion) / 6) * 100 };
}

function EscalaIca({ estado }) {
  if (!estado.ventana_ica_horas) return null;
  if (!estado.categoria) {
    const minimo = Math.ceil(estado.ventana_ica_horas * 0.75);
    return (
      <p className="sin-ica">
        No se puede calcular el ICA: ningún periodo de esta serie tiene las {minimo} de {estado.ventana_ica_horas}{" "}
        horas válidas que exige el cálculo, o el valor está fuera de la escala de {estado.ventana_ica_horas} horas.
      </p>
    );
  }
  const { indice, porcentaje } = posicionEnEscala(estado.ica);
  return (
    <div className="escala">
      <p className="escala-categoria">
        <strong>{estado.categoria}</strong>
        <span>ICA {estado.ica}</span>
      </p>
      <div className="escala-barra" role="img"
           aria-label={`ICA ${estado.ica}, categoría ${estado.categoria}, en una escala de 0 a 500`}>
        {COLORES_ICA.map((color, i) => (
          <span key={color} className={i === indice ? "segmento actual" : "segmento"} style={{ background: color }} />
        ))}
        <span className="escala-pista" style={{ transform: `translateX(${porcentaje}%)` }}>
          <span className="escala-marcador" />
        </span>
      </div>
      <div className="escala-extremos" aria-hidden="true"><span>Buena</span><span>Peligrosa</span></div>
      <p className="escala-detalle">
        {estado.ventana_ica_horas === 1
          ? <>Valor de {formatearNumero(estado.promedio_ica)} µg/m³ en la hora que termina el {formatearFecha(estado.instante_ica)}.</>
          : <>Promedio de {formatearNumero(estado.promedio_ica)} µg/m³ en las {estado.ventana_ica_horas} horas que terminan
              el {formatearFecha(estado.instante_ica)}, con {estado.horas_validas_ica} horas válidas.</>}
      </p>
    </div>
  );
}

function GuiaOms({ estado }) {
  const guia = estado.guia_oms;
  if (!guia) return null;
  if (guia.comparable && estado.promedio_ica != null) {
    const supera = estado.promedio_ica > guia.valor;
    return (
      <p className="oms">
        La guía de la OMS recomienda no superar {formatearNumero(guia.valor)} µg/m³ en {guia.periodo}. Ese promedio{" "}
        {supera ? "la supera" : "está por debajo"}.
      </p>
    );
  }
  return (
    <p className="oms">
      Guía de la OMS: {formatearNumero(guia.valor)} µg/m³ como promedio de {guia.periodo}. No se compara porque el ICA
      usa otro periodo.
    </p>
  );
}

// Los sensores de la red OAC22 son de bajo costo: en los 30 días revisados su
// PM10 fue casi igual a su PM2.5 (razón de 1,00 a 1,12), cuando el PM10 incluye
// al PM2.5 y suele ser bastante mayor (docs/bitacora.md, 2026-10-22).
const NOTAS_FUENTE = {
  "SATIC (red OAC22)": {
    PM10: "Los sensores de esta red son de bajo costo y su PM10 es casi igual a su PM2.5, así que este valor y su ICA "
      + "probablemente están por debajo del PM10 real.",
  },
};

const TEXTO_MARCA = {
  sospechoso: "el sensor repite el mismo valor hora tras hora, lo que indica una falla",
  fuera_de_rango: "su valor está fuera del rango físico posible",
};

function AvisoMarcada({ marcada, hayValido }) {
  if (!marcada) return null;
  return (
    <p className="aviso-calidad" role="note">
      <strong>Datos no confiables</strong> {hayValido ? "Las mediciones posteriores al último dato válido" : "Las mediciones"},
      hasta la del {formatearFecha(marcada.instante)}, están marcadas porque {TEXTO_MARCA[marcada.bandera]}. No se usan
      para el ICA{hayValido ? ", que se calcula con el último dato válido" : ""}.
    </p>
  );
}

// Las mediciones anómalas (RF-13) se marcan sobre la línea con un punto hueco.
export function PuntoAnomalo({ cx, cy, payload, index }) {
  if (!payload?.anomalia || cx == null || cy == null) return <g key={index} />;
  return <circle key={index} cx={cx} cy={cy} r={5} fill="var(--papel)" stroke="var(--anomalia)" strokeWidth={2} />;
}

function AvisoAnomalias({ estado }) {
  if (!estado.anomalias_48h) return null;
  return (
    <p className="aviso-anomalia" role="note">
      <strong>{estado.ultima_anomala || estado.anomalias_48h === 1 ? "Valor anómalo" : "Valores anómalos"}</strong>{" "}
      {estado.ultima_anomala ? "El último dato fue señalado como anómalo" :
        `${estado.anomalias_48h} ${estado.anomalias_48h === 1 ? "valor señalado" : "valores señalados"} como anómalos en las
         últimas 48 horas`}{" "}
      por la detección de anomalías (Isolation Forest). Puede ser un error del sensor o un evento real, como una quema:
      el valor no se modifica.
    </p>
  );
}

function AvisoAlerta({ alerta }) {
  if (!alerta) return null;
  return (
    <p className="aviso-alerta" role="alert" style={{ borderColor: COLOR_ALERTA }}>
      <strong>Alerta</strong> {formatearNumero(alerta.valor)} {alerta.unidad} el {formatearFecha(alerta.instante)}, igual
      o por encima del umbral de {formatearNumero(alerta.umbral)} {alerta.unidad} configurado para{" "}
      {nombreCorto(alerta.parametro)}.
    </p>
  );
}

// Ruido (RF-15): se compara con el límite de la Resolución 627 de 2006 del
// periodo (día o noche) en que se midió.
function NormaRuido({ estado, umbrales }) {
  const limites = umbrales?.RUIDO?.ruido;
  if (!limites?.["Día"]) return null;
  const periodo = periodoRuido(estado.instante);
  const limite = limites[periodo];
  const supera = estado.valor_horario > limite;
  return (
    <p className="oms">
      La Resolución 627 de 2006 fija {formatearNumero(limite)} dB(A) {periodo === "Día" ? "de día" : "de noche"} en zonas
      residenciales, universidades y colegios (sector B). Este valor, medido {periodo === "Día" ? "de día" : "de noche"},{" "}
      {supera ? "lo supera" : "está por debajo"}. El límite exacto depende del uso del suelo de la estación.
    </p>
  );
}

// Serie de las últimas 48 horas, solo para las fuentes que publican datos recientes.
function UltimasHoras({ registro, parametro, meta, ahora }) {
  const [puntos, setPuntos] = useState(null);
  useEffect(() => {
    let activa = true;
    const hasta = fechaISO(ahora);
    api.serie(registro.id, { parametro, desde: restarDias(hasta, 2), hasta, agregacion: "hora" })
      .then((s) => {
        if (!activa) return;
        const limite = ahora - 48 * 3600000;
        setPuntos(s.datos.filter((d) => new Date(d.instante) >= limite)
          .map((d) => ({ t: d.instante, valor: d.valor, anomalia: d.anomalia })));
      })
      .catch(() => { if (activa) setPuntos([]); });
    return () => { activa = false; };
  }, [registro.id, parametro, ahora]);
  const validos = (puntos || []).filter((p) => p.valor != null);
  if (!validos.length) return null;
  const maximo = validos.reduce((m, p) => (p.valor > m.valor ? p : m));
  const guia = registro.parametros[parametro]?.guia_oms;
  return (
    <figure className="ultimas-horas">
      <figcaption>
        Últimas 48 horas, valores horarios. Máximo: {formatearNumero(maximo.valor)} {meta?.unidad} el{" "}
        {formatearFecha(maximo.t)}.
      </figcaption>
      <div role="img" aria-label={`Serie de ${nombreCorto(parametro)} de las últimas 48 horas, con ${validos.length} horas con dato`}>
        <ResponsiveContainer width="100%" height={96}>
          <LineChart data={puntos} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="t" hide />
            <YAxis width={30} tick={{ fontSize: 11, fill: "var(--eje-texto)" }} axisLine={false} tickLine={false}
                   tickFormatter={formatearNumero} tickCount={3}
                   domain={meta?.variable === "meteorologia" ? ["auto", "auto"] : [0, "auto"]} />
            <Tooltip contentStyle={{ borderRadius: 8, fontSize: 13 }}
                     formatter={(v) => [v == null ? "sin dato" : `${formatearNumero(v)} ${meta?.unidad || ""}`, nombreCorto(parametro)]}
                     labelFormatter={(t) => formatearFecha(t)} />
            {guia?.periodo === "24 horas" && guia.valor <= maximo.valor * 2 && (
              <ReferenceLine y={guia.valor} stroke="var(--referencia-oms)" strokeDasharray="2 3" />
            )}
            <Line type="linear" dataKey="valor" stroke="var(--serie)" strokeWidth={2} dot={PuntoAnomalo}
                  connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {guia?.periodo === "24 horas" && guia.valor <= maximo.valor * 2 && (
        <p className="clave-guia">
          <svg width="20" height="6" aria-hidden="true"><line x1="0" y1="3" x2="20" y2="3" stroke="var(--referencia-oms)" strokeDasharray="2 3" /></svg>
          Guía de la OMS para 24 horas ({formatearNumero(guia.valor)} {meta?.unidad})
        </p>
      )}
    </figure>
  );
}

function DatoFuente({ registro, parametro, meta, onVerHistorico, ahora, alertas, umbrales }) {
  const estado = registro.parametros[parametro];
  const nombre = nombreCorto(parametro);
  const nota = NOTAS_FUENTE[registro.fuente]?.[parametro];
  if (!estado) {
    return (
      <section className="fuente-dato">
        <h3>{registro.fuente}</h3>
        <p className="nota">Esta fuente no publica {nombre} para la estación.</p>
      </section>
    );
  }
  if (!estado.instante) {
    return (
      <section className="fuente-dato">
        <h3>{registro.fuente}</h3>
        <div className="avisos"><AvisoMarcada marcada={estado.ultima_marcada} hayValido={false} /></div>
      </section>
    );
  }
  const reciente = esReciente(estado.instante, ahora);
  return (
    <section className="fuente-dato">
      <h3>{registro.fuente}</h3>
      <p className="cifra">
        <strong>{formatearNumero(estado.valor_horario)}</strong>
        <span>{meta?.unidad} de {nombre}, último valor horario</span>
      </p>
      <p className="fecha-dato">
        Medido el {formatearFecha(estado.instante)},{" "}
        <span className={`antiguedad${reciente ? " reciente" : ""}`}>{antiguedad(estado.instante, ahora)}</span>
      </p>
      {/* Avisos en orden de gravedad: alerta, datos no confiables, anomalía y nota sobre la fuente. */}
      <div className="avisos">
        <AvisoAlerta alerta={alertas.find((a) => a.estacion_id === registro.id && a.parametro === parametro)} />
        <AvisoMarcada marcada={estado.ultima_marcada} hayValido />
        <AvisoAnomalias estado={estado} />
        {nota && <p className="nota-fuente"><strong>Sobre esta fuente</strong> {nota}</p>}
      </div>
      <EscalaIca estado={estado} />
      <GuiaOms estado={estado} />
      {parametro === "RUIDO" && <NormaRuido estado={estado} umbrales={umbrales} />}
      {reciente && <UltimasHoras registro={registro} parametro={parametro} meta={meta} ahora={ahora} />}
      <button className="boton" onClick={() => onVerHistorico(registro.id)}>Ver el histórico de esta fuente</button>
    </section>
  );
}

// Lo que dice la ficha cuando no hay una estación elegida, según el estado de la carga.
const FICHA_VACIA = {
  cargando: ["Cargando las estaciones…", "En unos segundos aparecen en el mapa y en la lista."],
  vacio: ["No hay estaciones para mostrar", "La plataforma no recibió estaciones de ninguna fuente. Vuelva a intentarlo más tarde."],
  error: ["No se pudieron cargar las estaciones", "Use «Reintentar» en el aviso de arriba."],
  listo: ["Elija una estación", "Toque una estación en el mapa o búsquela en la lista para ver su último dato y, en los "
    + "contaminantes, su categoría del ICA."],
};

export default function Ficha({ grupo, parametro, meta, zonas, onVerHistorico, ahora, alertas = [], umbrales,
                                carga = "listo" }) {
  if (!grupo) {
    const [titulo, texto] = FICHA_VACIA[carga];
    return (
      <section className="ficha vacia" aria-busy={carga === "cargando"}>
        <h2>{titulo}</h2>
        <p className={carga === "cargando" ? "cargando" : undefined}>{texto}</p>
      </section>
    );
  }
  return (
    // Sin aria-live: al elegir una estación el foco pasa al nombre (App.jsx), y
    // así el lector no vuelve a leer toda la ficha con cada actualización.
    // La clave hace que la ficha se vuelva a montar al cambiar de estación (con su
    // fundido de entrada) y no cuando solo cambia la variable.
    <section className="ficha" aria-labelledby="titulo-ficha" key={grupo.id}>
      <h2 id="titulo-ficha" tabIndex={-1}>{grupo.nombre}</h2>
      {zonas && zonaDe(zonas, grupo.coordenadas) && <p className="zona">{zonaDe(zonas, grupo.coordenadas)}</p>}
      {grupo.registros.length > 1 && (
        <p className="nota">Dos fuentes publican datos de esta estación. Se muestran por separado.</p>
      )}
      {grupo.registros.map((r) => (
        <DatoFuente key={r.id} registro={r} parametro={parametro} meta={meta} onVerHistorico={onVerHistorico}
                    ahora={ahora} alertas={alertas} umbrales={umbrales} />
      ))}
    </section>
  );
}
