import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";
import { fechaISO, formatearFecha, formatearNumero, PARAMETROS, restarDias } from "../util.js";

const MAXIMO_DIAS_HORARIO = 93;

function diasEntre(desde, hasta) {
  return Math.round((new Date(hasta) - new Date(desde)) / 86400000);
}

export default function Historico({ grupos, umbrales, destino }) {
  const opciones = useMemo(
    () => grupos.flatMap((g) => g.registros.map((r) => ({ id: r.id, etiqueta: `${g.nombre} (${r.fuente})`, registro: r })))
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es")),
    [grupos]);
  const [estacionId, setEstacionId] = useState(destino?.estacionId ?? null);
  const [parametro, setParametro] = useState(destino?.parametro ?? "PM25");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [rango, setRango] = useState(null);
  const [serie, setSerie] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [verTabla, setVerTabla] = useState(false);

  useEffect(() => {
    if (estacionId == null && opciones.length) setEstacionId(opciones[0].id);
  }, [opciones, estacionId]);

  // Al cambiar de estación o parámetro se proponen 30 días que terminan en el
  // último periodo representativo de la serie. Al final de muchas series hay
  // muy pocos datos, y empezar ahí mostraría una gráfica casi vacía.
  useEffect(() => {
    if (estacionId == null) return;
    setRango(null); setSerie(null); setError(null);
    const estado = opciones.find((o) => o.id === estacionId)?.registro.parametros[parametro];
    api.rango(estacionId, parametro)
      .then((r) => {
        const fin = estado?.instante_ica ? fechaISO(new Date(estado.instante_ica)) : r.hasta;
        setRango(r); setHasta(fin); setDesde(restarDias(fin, 30));
      })
      .catch((e) => setError(e.message));
  }, [estacionId, parametro]); // eslint-disable-line react-hooks/exhaustive-deps

  const agregacion = desde && hasta && diasEntre(desde, hasta) > MAXIMO_DIAS_HORARIO ? "dia" : "hora";
  const consulta = { parametro, desde, hasta, agregacion };

  function consultar() {
    if (!desde || !hasta) return;
    setCargando(true); setError(null);
    api.serie(estacionId, consulta)
      .then(setSerie).catch((e) => setError(e.message)).finally(() => setCargando(false));
  }

  useEffect(() => { if (rango && desde && hasta) consultar(); }, [rango]); // eslint-disable-line react-hooks/exhaustive-deps

  const puntos = (serie?.datos || []).map((d) => ({ t: d.instante || d.dia, valor: d.valor }));
  const faltantes = puntos.filter((p) => p.valor == null).length;
  const validos = puntos.filter((p) => p.valor != null);
  const promedio = validos.length ? validos.reduce((s, p) => s + p.valor, 0) / validos.length : null;
  const limites = umbrales?.[parametro];
  const limiteAceptable = limites?.ica.find((c) => c.categoria === "Aceptable")?.superior;
  const guiaOms = limites?.oms["24 horas"];
  const unidad = agregacion === "hora" ? "horas" : "días";
  const seleccionada = opciones.find((o) => o.id === estacionId);
  const fechaEje = (t) => (t.length > 10 ? t : t + "T12:00:00Z");

  return (
    <section className="historico">
      <h2>Histórico</h2>
      <p className="nota">Consulte la serie de una estación, compárela con la norma y descargue los datos.</p>
      <form className="filtros" onSubmit={(e) => { e.preventDefault(); consultar(); }}>
        <label>Estación y fuente
          <select value={estacionId ?? ""} onChange={(e) => setEstacionId(Number(e.target.value))}>
            {opciones.map((o) => <option key={o.id} value={o.id}>{o.etiqueta}</option>)}
          </select>
        </label>
        <label>Contaminante
          <select value={parametro} onChange={(e) => setParametro(e.target.value)}>
            {Object.entries(PARAMETROS).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </label>
        <label>Desde
          <input type="date" value={desde} min={rango?.desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>Hasta
          <input type="date" value={hasta} min={desde} max={rango?.hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <button className="boton primario" type="submit" disabled={!desde || !hasta || cargando}>
          {cargando ? "Consultando…" : "Consultar"}
        </button>
      </form>
      {rango && (
        <p className="nota">
          Hay datos del {formatearFecha(fechaEje(rango.desde), false)} al {formatearFecha(fechaEje(rango.hasta), false)}.
          {agregacion === "dia" && " Para más de 93 días la serie se muestra como promedio diario."}
        </p>
      )}
      {error && <p className="aviso error" role="alert">{error}</p>}

      {serie && (
        <div className="lienzo">
          <div className="lienzo-encabezado">
            <h3>{PARAMETROS[parametro]} en {seleccionada?.etiqueta}</h3>
          </div>
          <dl className="cifras">
            <div><dt>Promedio del periodo</dt><dd>{promedio != null ? `${formatearNumero(promedio)} µg/m³` : "—"}</dd></div>
            <div><dt>{agregacion === "hora" ? "Horas con dato" : "Días con dato"}</dt><dd>{validos.length}</dd></div>
            <div><dt>Sin dato</dt><dd>{puntos.length ? `${Math.round((100 * faltantes) / puntos.length)} %` : "—"}</dd></div>
          </dl>
          <p className="unidad-eje">Concentración en µg/m³, {agregacion === "hora" ? "valores horarios" : "promedios diarios"}</p>
          <div role="img" aria-label={`Serie de ${PARAMETROS[parametro]} con ${validos.length} ${unidad} con dato y ${faltantes} sin dato`}>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={puntos} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="#e3e9e6" vertical={false} />
                <XAxis dataKey="t" tickFormatter={(t) => formatearFecha(fechaEje(t), false)} minTickGap={56}
                       tick={{ fontSize: 12, fill: "#4a5d58" }} axisLine={{ stroke: "#d3dcd8" }} tickLine={false} />
                <YAxis width={44} tick={{ fontSize: 12, fill: "#4a5d58" }} tickFormatter={formatearNumero}
                       axisLine={false} tickLine={false}
                       domain={[0, (maximo) => Math.ceil(Math.max(maximo, limiteAceptable ?? 0, guiaOms ?? 0) * 1.1)]} />
                <Tooltip cursor={{ stroke: "#17322e", strokeWidth: 1 }}
                         contentStyle={{ borderRadius: 8, borderColor: "#d3dcd8", fontFamily: "inherit" }}
                         formatter={(v) => [v == null ? "sin dato" : `${formatearNumero(v)} µg/m³`, PARAMETROS[parametro]]}
                         labelFormatter={(t) => formatearFecha(fechaEje(t), agregacion === "hora")} />
                {limiteAceptable != null && (
                  <ReferenceLine y={limiteAceptable} stroke="#17322e" strokeDasharray="5 4" strokeWidth={1} />
                )}
                {guiaOms != null && (
                  <ReferenceLine y={guiaOms} stroke="#6b7c77" strokeDasharray="2 3" strokeWidth={1} />
                )}
                <Line type="linear" dataKey="valor" stroke="var(--serie)" strokeWidth={2} connectNulls={false}
                      dot={validos.length < 60 ? { r: 4, fill: "var(--serie)", stroke: "#fff", strokeWidth: 2 } : false}
                      activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul className="referencias">
            <li>
              <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--serie)" strokeWidth="2" /></svg>
              {PARAMETROS[parametro]} medido
            </li>
            {limiteAceptable != null && (
              <li>
                <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke="#17322e" strokeDasharray="5 4" /></svg>
                Fin de la categoría Aceptable del ICA ({limiteAceptable} µg/m³)
              </li>
            )}
            {guiaOms != null && (
              <li>
                <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke="#6b7c77" strokeDasharray="2 3" /></svg>
                Guía de la OMS para 24 horas ({guiaOms} µg/m³)
              </li>
            )}
          </ul>
          <p className="resumen">
            Los huecos de la línea son {unidad} sin dato: se dejan vacíos y no se rellenan. Las líneas de referencia del
            ICA y de la OMS corresponden a promedios de 24 horas.
          </p>
          <div className="acciones">
            <a className="boton" href={api.urlCsv(estacionId, consulta)} download>Descargar los datos en CSV</a>
            <a className="boton" href={api.urlSerie(estacionId, consulta)} target="_blank" rel="noreferrer">Abrir en la API</a>
            <button className="boton texto" type="button" aria-expanded={verTabla} onClick={() => setVerTabla(!verTabla)}>
              {verTabla ? "Ocultar la tabla" : "Ver los datos como tabla"}
            </button>
          </div>
          {verTabla && (
            <div className="tabla-datos">
              <table>
                <thead><tr><th scope="col">{agregacion === "hora" ? "Fecha y hora" : "Día"}</th><th scope="col">Valor (µg/m³)</th></tr></thead>
                <tbody>
                  {puntos.map((p) => (
                    <tr key={p.t}>
                      <td>{formatearFecha(fechaEje(p.t), agregacion === "hora")}</td>
                      <td className="numero">{p.valor == null ? "sin dato" : formatearNumero(p.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
