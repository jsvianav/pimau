import { useEffect, useState } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";
import { antiguedad, esReciente, fechaISO, formatearFecha, formatearNumero, nombreCorto, restarDias, zonaDe } from "../util.js";

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
          <span key={color} className={i === indice ? "actual" : undefined} style={{ background: color }} />
        ))}
        <span className="escala-marcador" style={{ left: `${porcentaje}%` }} />
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
      <strong>Datos no confiables.</strong> {hayValido ? "Las mediciones posteriores al último dato válido" : "Las mediciones"},
      hasta la del {formatearFecha(marcada.instante)}, están marcadas porque {TEXTO_MARCA[marcada.bandera]}. No se usan
      para el ICA{hayValido ? ", que se calcula con el último dato válido" : ""}.
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
        setPuntos(s.datos.filter((d) => new Date(d.instante) >= limite).map((d) => ({ t: d.instante, valor: d.valor })));
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
            <YAxis width={30} tick={{ fontSize: 11, fill: "#52625e" }} axisLine={false} tickLine={false}
                   tickFormatter={formatearNumero} tickCount={3}
                   domain={meta?.variable === "meteorologia" ? ["auto", "auto"] : [0, "auto"]} />
            <Tooltip contentStyle={{ borderRadius: 8, borderColor: "#d3dcd8", fontSize: 13 }}
                     formatter={(v) => [v == null ? "sin dato" : `${formatearNumero(v)} ${meta?.unidad || ""}`, nombreCorto(parametro)]}
                     labelFormatter={(t) => formatearFecha(t)} />
            {guia?.periodo === "24 horas" && guia.valor <= maximo.valor * 2 && (
              <ReferenceLine y={guia.valor} stroke="#6b7c77" strokeDasharray="2 3" />
            )}
            <Line type="linear" dataKey="valor" stroke="var(--serie)" strokeWidth={2} dot={false}
                  connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {guia?.periodo === "24 horas" && guia.valor <= maximo.valor * 2 && (
        <p className="clave-guia">
          <svg width="20" height="6" aria-hidden="true"><line x1="0" y1="3" x2="20" y2="3" stroke="#6b7c77" strokeDasharray="2 3" /></svg>
          Guía de la OMS para 24 horas ({formatearNumero(guia.valor)} {meta?.unidad})
        </p>
      )}
    </figure>
  );
}

function DatoFuente({ registro, parametro, meta, onVerHistorico, ahora }) {
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
        <AvisoMarcada marcada={estado.ultima_marcada} hayValido={false} />
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
      <AvisoMarcada marcada={estado.ultima_marcada} hayValido />
      {nota && <p className="nota-fuente">{nota}</p>}
      <EscalaIca estado={estado} />
      <GuiaOms estado={estado} />
      {reciente && <UltimasHoras registro={registro} parametro={parametro} meta={meta} ahora={ahora} />}
      <button className="boton" onClick={() => onVerHistorico(registro.id)}>Ver el histórico de esta fuente</button>
    </section>
  );
}

export default function Ficha({ grupo, parametro, meta, zonas, onVerHistorico, ahora }) {
  if (!grupo) {
    return (
      <section className="ficha vacia">
        <h2>Elija una estación</h2>
        <p>Toque una estación en el mapa o búsquela en la lista para ver su último dato y, en los contaminantes, su
          categoría del ICA.</p>
      </section>
    );
  }
  return (
    <section className="ficha" aria-live="polite">
      <h2>{grupo.nombre}</h2>
      {zonas && zonaDe(zonas, grupo.coordenadas) && <p className="zona">{zonaDe(zonas, grupo.coordenadas)}</p>}
      {grupo.registros.length > 1 && (
        <p className="nota">Dos fuentes publican datos de esta estación. Se muestran por separado.</p>
      )}
      {grupo.registros.map((r) => (
        <DatoFuente key={r.id} registro={r} parametro={parametro} meta={meta} onVerHistorico={onVerHistorico} ahora={ahora} />
      ))}
    </section>
  );
}
