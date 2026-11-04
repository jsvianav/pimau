import { useEffect, useState } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";
import { antiguedadCorta, fechaISO, formatearFecha, formatearNumero, nombreCorto, restarDias } from "../util.js";
import PuntoAnomalo from "./PuntoAnomalo.jsx";

// Serie de las últimas 48 horas, solo para las fuentes que publican datos
// recientes. Va en su propio archivo porque la ficha la carga de forma
// diferida: así Recharts no entra en la carga inicial de la página.
export default function UltimasHoras({ registro, parametro, meta, ahora }) {
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
            <YAxis width={36} tick={{ fontSize: 12, fill: "var(--eje-texto)" }} axisLine={false} tickLine={false}
                   tickFormatter={formatearNumero} tickCount={3}
                   domain={meta?.variable === "meteorologia" ? ["auto", "auto"] : [0, "auto"]} />
            <Tooltip contentStyle={{ borderRadius: 8, fontSize: 14 }}
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
      {/* El eje X va oculto para que la gráfica quepa en la ficha; los extremos
          dicen de cuándo es el primer y el último punto sin pasar el puntero. */}
      <p className="eje-tiempo" aria-hidden="true">
        <span>{antiguedadCorta(puntos[0].t, ahora)}</span>
        <span>{antiguedadCorta(puntos.at(-1).t, ahora)}</span>
      </p>
      {guia?.periodo === "24 horas" && guia.valor <= maximo.valor * 2 && (
        <p className="clave-guia">
          <svg width="20" height="6" aria-hidden="true"><line x1="0" y1="3" x2="20" y2="3" stroke="var(--referencia-oms)" strokeDasharray="2 3" /></svg>
          Guía de la OMS para 24 horas ({formatearNumero(guia.valor)} {meta?.unidad})
        </p>
      )}
    </figure>
  );
}
