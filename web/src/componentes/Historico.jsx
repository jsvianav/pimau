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
    () => grupos.flatMap((g) => g.registros.map((r) => ({ id: r.id, etiqueta: `${g.nombre} · ${r.fuente}`, registro: r })))
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

  return (
    <section className="historico">
      <h2>Histórico</h2>
      <form className="filtros" onSubmit={(e) => { e.preventDefault(); consultar(); }}>
        <label>Estación y fuente
          <select value={estacionId ?? ""} onChange={(e) => setEstacionId(Number(e.target.value))}>
            {opciones.map((o) => <option key={o.id} value={o.id}>{o.etiqueta}</option>)}
          </select>
        </label>
        <label>Parámetro
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
          Datos disponibles del {formatearFecha(rango.desde + "T12:00:00Z", false)} al{" "}
          {formatearFecha(rango.hasta + "T12:00:00Z", false)}.{" "}
          {agregacion === "dia" && "Para rangos de más de 93 días la serie se muestra como promedio diario."}
        </p>
      )}
      {error && <p className="aviso error" role="alert">{error}</p>}

      {serie && (
        <>
          <div className="grafica" role="img"
               aria-label={`Serie de ${PARAMETROS[parametro]} con ${validos.length} ${unidad} con dato y ${faltantes} sin dato`}>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={puntos} margin={{ top: 16, right: 24, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="t" tickFormatter={(t) => formatearFecha(t.length > 10 ? t : t + "T12:00:00Z", false)}
                       minTickGap={48} tick={{ fontSize: 12 }} />
                <YAxis unit=" µg/m³" width={80} tick={{ fontSize: 12 }} tickFormatter={formatearNumero}
                       domain={[0, (maximo) => Math.ceil(Math.max(maximo, limiteAceptable ?? 0, guiaOms ?? 0) * 1.1)]} />
                <Tooltip formatter={(v) => (v == null ? "sin dato" : `${formatearNumero(v)} µg/m³`)}
                         labelFormatter={(t) => formatearFecha(t.length > 10 ? t : t + "T12:00:00Z", agregacion === "hora")} />
                {limiteAceptable != null && (
                  <ReferenceLine y={limiteAceptable} stroke="#c2410c" strokeDasharray="6 4"
                    label={{ value: `Límite de "Aceptable" en el ICA (${limiteAceptable})`, position: "insideTopLeft", fill: "#9a3412", fontSize: 12 }} />
                )}
                {guiaOms != null && (
                  <ReferenceLine y={guiaOms} stroke="#15803d" strokeDasharray="6 4"
                    label={{ value: `Guía OMS 24 h (${guiaOms})`, position: "insideBottomLeft", fill: "#166534", fontSize: 12 }} />
                )}
                <Line type="monotone" dataKey="valor" stroke="#1168BD" strokeWidth={1.6}
                      dot={validos.length < 60 ? { r: 2.5, fill: "#1168BD" } : false}
                      connectNulls={false} isAnimationActive={false} name={PARAMETROS[parametro]} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="resumen">
            {validos.length} {unidad} con dato, {faltantes} sin dato
            {puntos.length ? ` (${Math.round((100 * faltantes) / puntos.length)} %)` : ""}.
            {promedio != null && ` Promedio del periodo: ${formatearNumero(promedio)} µg/m³.`} Los huecos de la línea son datos faltantes: se
            muestran vacíos y no se rellenan. Las líneas de referencia del ICA y de la OMS corresponden a promedios de
            24 horas.
          </p>
          <div className="acciones">
            <a className="boton" href={api.urlCsv(estacionId, consulta)} download>Descargar CSV</a>
            <a className="boton" href={api.urlSerie(estacionId, consulta)} target="_blank" rel="noreferrer">Ver en la API</a>
          </div>
        </>
      )}
    </section>
  );
}
