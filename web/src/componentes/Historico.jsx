import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.js";
import { fechaISO, formatearFecha, formatearNumero, marcasEje, nombreCorto, restarDias, textoVentana } from "../util.js";
import SelectorParametro from "./SelectorParametro.jsx";
import PuntoAnomalo from "./PuntoAnomalo.jsx";
import AvisoError from "./AvisoError.jsx";
import CicloDiario from "./CicloDiario.jsx";

const MAXIMO_DIAS_HORARIO = 93;
const MARCAS_NO_CONFIABLES = { sospechoso: "valor repetido", fuera_de_rango: "fuera de rango" };
// El puntaje de anomalía va de 0 a 1 y las señaladas quedan entre 0,62 y 0,8:
// con un solo decimal no se distinguen.
const PUNTAJE = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatearPuntaje = (valor) => (valor == null ? "—" : PUNTAJE.format(valor));

// Atajos de periodo: terminan en el último dato de la serie y consultan de una vez.
const ATAJOS = [["7 días", 7], ["30 días", 30], ["1 año", 365], ["Todo", null]];

function diasEntre(desde, hasta) {
  return Math.round((new Date(hasta) - new Date(desde)) / 86400000);
}

function agregacionPara(desde, hasta) {
  return desde && hasta && diasEntre(desde, hasta) > MAXIMO_DIAS_HORARIO ? "dia" : "hora";
}

function inicioDeAtajo(rango, dias) {
  if (dias == null) return rango.desde;
  const inicio = restarDias(rango.hasta, dias);
  return inicio < rango.desde ? rango.desde : inicio;
}

export default function Historico({ grupos, umbrales, parametros, meta, destino, onConsulta }) {
  const todas = useMemo(
    () => grupos.flatMap((g) => g.registros.map((r) => ({ id: r.id, etiqueta: `${g.nombre} (${r.fuente})`, registro: r })))
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es")),
    [grupos]);
  const [estacionElegida, setEstacionElegida] = useState(destino?.estacionId ?? null);
  const [parametro, setParametro] = useState(destino?.parametro ?? "PM25");
  // Solo se ofrecen las estaciones que miden la variable elegida.
  const opciones = useMemo(() => todas.filter((o) => o.registro.parametros[parametro]), [todas, parametro]);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [rango, setRango] = useState(null);
  const [serie, setSerie] = useState(null);
  const [comparar, setComparar] = useState(null);
  const [serieComparada, setSerieComparada] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [verTabla, setVerTabla] = useState(false);
  // Sin una estación elegida (o si el enlace nombra una que no existe o no mide
  // la variable) se muestra la de dato más reciente: la primera en orden
  // alfabético podía ser una estación sin datos desde hace años.
  const masReciente = opciones.reduce((mejor, o) => {
    const instante = o.registro.parametros[parametro]?.instante || "";
    return !mejor || instante > (mejor.registro.parametros[parametro]?.instante || "") ? o : mejor;
  }, null);
  const estacionId = opciones.some((o) => o.id === estacionElegida) ? estacionElegida : masReciente?.id ?? null;
  const comparada = opciones.find((o) => o.id === comparar && o.id !== estacionId) || null;
  // Periodo de la serie que se ve, para pedir la comparación sobre el mismo.
  const ultimaConsulta = useRef(null);
  // Fechas que pidió el enlace (?desde=…&hasta=…): se usan en la primera consulta.
  const fechasPedidas = useRef(destino?.desde && destino?.hasta ? { desde: destino.desde, hasta: destino.hasta } : null);

  // Cambiar de estación o de parámetro borra la consulta anterior.
  function limpiarConsulta() {
    setRango(null); setSerie(null); setSerieComparada(null); setError(null);
  }
  function cambiarEstacion(id) {
    // Si la nueva estación era la comparada, la comparación se descarta del todo.
    if (id === comparar) setComparar(null);
    setEstacionElegida(id); limpiarConsulta();
  }
  function cambiarParametro(codigo) { setParametro(codigo); setComparar(null); limpiarConsulta(); }

  function pedirComparacion(id, consulta, vigente = () => true) {
    if (!id) { setSerieComparada(null); return; }
    api.serie(id, consulta)
      .then((s) => { if (vigente()) setSerieComparada(s); })
      .catch((e) => { if (vigente()) { setSerieComparada(null); setError(e); } });
  }

  function pedirSerie(id, consulta, vigente = () => true) {
    setCargando(true); setError(null);
    ultimaConsulta.current = consulta;
    pedirComparacion(comparada?.id, consulta, vigente);
    return api.serie(id, consulta)
      .then((s) => {
        if (!vigente()) return;
        setSerie(s);
        onConsulta?.({ estacionId: id, parametro: consulta.parametro, desde: consulta.desde, hasta: consulta.hasta });
      })
      .catch((e) => { if (vigente()) setError(e); })
      .finally(() => { if (vigente()) setCargando(false); });
  }

  // Al cambiar de estación o parámetro se proponen 30 días que terminan en el
  // último periodo representativo de la serie y se consulta ese periodo. Al
  // final de muchas series hay muy pocos datos, y empezar ahí mostraría una
  // gráfica casi vacía.
  useEffect(() => {
    if (estacionId == null) return;
    let activa = true;
    const vigente = () => activa;
    const estado = opciones.find((o) => o.id === estacionId)?.registro.parametros[parametro];
    api.rango(estacionId, parametro)
      .then((r) => {
        if (!activa) return;
        const pedidas = fechasPedidas.current;
        fechasPedidas.current = null;
        const fin = pedidas?.hasta ?? (estado?.instante_ica ? fechaISO(new Date(estado.instante_ica)) : r.hasta);
        const inicio = pedidas?.desde ?? restarDias(fin, 30);
        setRango(r); setHasta(fin); setDesde(inicio);
        // Un enlace puede pedir más de 93 días: entonces la serie va en promedios diarios.
        return pedirSerie(estacionId, { parametro, desde: inicio, hasta: fin, agregacion: agregacionPara(inicio, fin) }, vigente);
      })
      .catch((e) => { if (activa) setError(e); });
    return () => { activa = false; };
  }, [estacionId, parametro]); // eslint-disable-line react-hooks/exhaustive-deps

  const agregacion = agregacionPara(desde, hasta);
  const consulta = { parametro, desde, hasta, agregacion };

  // El botón nunca queda deshabilitado por faltar una fecha: al pulsarlo, el
  // aviso dice qué falta (skill forms).
  function consultar() {
    if (!desde || !hasta) {
      setError("Elija la fecha de inicio y la de fin para consultar.");
      return;
    }
    pedirSerie(estacionId, consulta);
  }

  function aplicarAtajo(dias) {
    const inicio = inicioDeAtajo(rango, dias);
    setDesde(inicio); setHasta(rango.hasta);
    pedirSerie(estacionId, { parametro, desde: inicio, hasta: rango.hasta, agregacion: agregacionPara(inicio, rango.hasta) });
  }

  function cambiarComparacion(id) {
    setComparar(id);
    // La comparación usa el mismo periodo de la serie que ya se ve.
    if (ultimaConsulta.current) pedirComparacion(id, ultimaConsulta.current);
  }

  // Las horas marcadas como no confiables (RF-03) se tratan como en el promedio
  // diario y en el ICA: no se dibujan ni entran en las cifras, pero se cuentan y
  // la tabla muestra su valor. Antes un sensor detenido en 0 daba un promedio de 0.
  const confiable = (d) => (MARCAS_NO_CONFIABLES[d.bandera] ? null : d.valor);
  // La serie comparada se cruza con la principal por instante (o por día).
  const valoresComparados = new Map((comparada && serieComparada?.datos || []).map((d) => [d.instante || d.dia, confiable(d)]));
  const puntos = (serie?.datos || []).map((d) => ({ t: d.instante || d.dia, valor: confiable(d), anomalia: d.anomalia,
                                                    puntaje: d.puntaje_anomalia,
                                                    marcado: MARCAS_NO_CONFIABLES[d.bandera] && d.valor != null
                                                      ? { valor: d.valor, motivo: MARCAS_NO_CONFIABLES[d.bandera] } : null,
                                                    comparada: valoresComparados.get(d.instante || d.dia) ?? null }));
  const hayComparacion = valoresComparados.size > 0;
  const anomalos = puntos.filter((p) => p.anomalia).length;
  const marcados = puntos.filter((p) => p.marcado).length;
  const faltantes = puntos.filter((p) => p.valor == null && !p.marcado).length;
  const validos = puntos.filter((p) => p.valor != null);
  const validosComparados = puntos.filter((p) => p.comparada != null);
  const promedioDe = (lista, campo) => (lista.length ? lista.reduce((s, p) => s + p[campo], 0) / lista.length : null);
  const promedio = promedioDe(validos, "valor");
  const promedioComparado = promedioDe(validosComparados, "comparada");
  const limites = umbrales?.[parametro];
  const datosParametro = meta?.[parametro];
  const unidadMedida = datosParametro?.unidad || "";
  const ventana = datosParametro?.ventana_ica_horas;
  const limiteAceptable = limites?.ica.find((c) => c.categoria === "Aceptable")?.superior;
  const periodoOms = limites?.oms && (ventana && limites.oms[`${ventana} horas`] ? `${ventana} horas`
    : Object.keys(limites.oms).find((p) => p !== "Anual"));
  const guiaOms = periodoOms ? limites.oms[periodoOms] : undefined;
  const nombre = nombreCorto(parametro);
  // Una referencia muy por encima de los datos aplastaría la serie: solo se
  // dibuja si no supera el doble del máximo del periodo.
  const maximo = Math.max(validos.reduce((m, p) => Math.max(m, p.valor), 0),
                          validosComparados.reduce((m, p) => Math.max(m, p.comparada), 0));
  const visible = (limite) => limite != null && maximo > 0 && limite <= maximo * 2;
  const verAceptable = visible(limiteAceptable);
  const verOms = visible(guiaOms);
  const ejeDesdeCero = datosParametro?.variable !== "meteorologia" || ["LLUVIA", "RAD"].includes(parametro);
  // Marcas redondas (0, 50, 100…) que incluyen las líneas de referencia visibles.
  const marcas = ejeDesdeCero
    ? marcasEje(Math.max(maximo, verAceptable ? limiteAceptable : 0, verOms ? guiaOms : 0)) : undefined;
  const unidad = agregacion === "hora" ? "horas" : "días";
  const seleccionada = opciones.find((o) => o.id === estacionId);
  const fechaEje = (t) => (t.length > 10 ? t : t + "T12:00:00Z");
  const atajoActivo = rango && hasta === rango.hasta ? ATAJOS.find(([, dias]) => desde === inicioDeAtajo(rango, dias))?.[0] : null;
  const valorLluvia = (v, n) => (parametro === "LLUVIA" ? v * n : v);

  return (
    <section className="historico">
      <h2>Histórico</h2>
      <p className="nota">Consulte la serie de una estación, compárela con otra o con la norma y descargue los datos.</p>
      {/* Sin estaciones (la API no respondió o no hay datos) el formulario no tiene nada que consultar. */}
      {!todas.length && <p className="nota">No hay estaciones para consultar todavía.</p>}
      {todas.length > 0 && !opciones.length && (
        <p className="nota">Ninguna estación publica {nombre}. Elija otra variable.</p>
      )}
      {todas.length > 0 && <form className="filtros" onSubmit={(e) => { e.preventDefault(); consultar(); }}>
        <label>Variable
          <SelectorParametro parametros={parametros} valor={parametro} onCambiar={cambiarParametro} />
        </label>
        <label>Estación y fuente
          <select value={estacionId ?? ""} onChange={(e) => cambiarEstacion(Number(e.target.value))}>
            {opciones.map((o) => <option key={o.id} value={o.id}>{o.etiqueta}</option>)}
          </select>
        </label>
        <label>Desde
          <input type="date" value={desde} min={rango?.desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>Hasta
          <input type="date" value={hasta} min={desde} max={rango?.hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <button className="boton primario" type="submit" disabled={cargando}>
          {cargando ? "Consultando…" : "Consultar"}
        </button>
        {rango && (
          <div className="atajos" role="group" aria-label="Periodos que terminan en el último dato">
            {ATAJOS.map(([texto, dias]) => (
              <button key={texto} className="boton" type="button" aria-pressed={atajoActivo === texto}
                      onClick={() => aplicarAtajo(dias)}>{texto}</button>
            ))}
          </div>
        )}
        {rango && (
          <p className="nota nota-rango">
            Hay datos del {formatearFecha(fechaEje(rango.desde), false)} al {formatearFecha(fechaEje(rango.hasta), false)}.
            {agregacion === "dia" && " Para más de 93 días la serie se muestra como promedio diario."}
          </p>
        )}
        {opciones.length > 1 && (
          <label className="campo-comparar">Comparar con
            <select value={comparada?.id ?? ""} onChange={(e) => cambiarComparacion(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Ninguna</option>
              {opciones.filter((o) => o.id !== estacionId).map((o) => <option key={o.id} value={o.id}>{o.etiqueta}</option>)}
            </select>
          </label>
        )}
      </form>}
      {error && <AvisoError titulo="No se pudo consultar la serie." error={error} />}

      {serie && (
        <div className="lienzo">
          <div className="lienzo-encabezado">
            <h3>{nombre} en {seleccionada?.etiqueta}{hayComparacion && <> y {comparada.etiqueta}</>}</h3>
          </div>
          <dl className="cifras">
            <div><dt>{parametro === "LLUVIA" ? "Lluvia del periodo" : "Promedio del periodo"}</dt>
              <dd>{promedio != null ? `${formatearNumero(valorLluvia(promedio, validos.length))} ${unidadMedida}` : "—"}</dd></div>
            {hayComparacion && (
              <div><dt>{parametro === "LLUVIA" ? "Lluvia en la comparación" : "Promedio de la comparación"}</dt>
                <dd>{promedioComparado != null
                  ? `${formatearNumero(valorLluvia(promedioComparado, validosComparados.length))} ${unidadMedida}` : "—"}</dd></div>
            )}
            <div><dt>{agregacion === "hora" ? "Horas con dato" : "Días con dato"}</dt><dd>{validos.length}</dd></div>
            <div><dt>Sin dato</dt><dd>{puntos.length ? `${Math.round((100 * faltantes) / puntos.length)} %` : "—"}</dd></div>
            {marcados > 0 && <div><dt>No confiables</dt><dd>{marcados}</dd></div>}
            {agregacion === "hora" && <div><dt>Valores anómalos</dt><dd>{anomalos}</dd></div>}
          </dl>
          <p className="unidad-eje">
            {nombre} en {unidadMedida},{" "}
            {agregacion === "hora" ? "valores horarios" : parametro === "LLUVIA" ? "totales diarios" : "promedios diarios"}
          </p>
          <div role="img" aria-label={`Serie de ${nombre} con ${validos.length} ${unidad} con dato y ${faltantes} sin dato${
            hayComparacion ? `, comparada con ${comparada.etiqueta}` : ""}`}>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={puntos} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="var(--rejilla)" vertical={false} />
                <XAxis dataKey="t" tickFormatter={(t) => formatearFecha(fechaEje(t), false)} minTickGap={56}
                       tick={{ fontSize: 12, fill: "var(--eje-texto)" }} axisLine={{ stroke: "var(--eje-linea)" }} tickLine={false} />
                <YAxis width={44} tick={{ fontSize: 12, fill: "var(--eje-texto)" }} tickFormatter={formatearNumero}
                       axisLine={false} tickLine={false} ticks={marcas}
                       domain={marcas ? [0, marcas.at(-1)] : ["auto", "auto"]} />
                <Tooltip cursor={{ stroke: "var(--referencia-ica)", strokeWidth: 1 }}
                         contentStyle={{ borderRadius: 8, fontFamily: "inherit" }}
                         formatter={(v, serieNombre, { payload, dataKey }) => [v == null ? "sin dato" : `${formatearNumero(v)} ${unidadMedida}${
                           dataKey === "valor" && payload?.anomalia ? ` · anómalo (Isolation Forest, puntaje ${formatearPuntaje(payload.puntaje)})` : ""}`,
                         serieNombre]}
                         labelFormatter={(t) => formatearFecha(fechaEje(t), agregacion === "hora")} />
                {verAceptable && (
                  <ReferenceLine y={limiteAceptable} stroke="var(--referencia-ica)" strokeDasharray="5 4" strokeWidth={1} />
                )}
                {verOms && (
                  <ReferenceLine y={guiaOms} stroke="var(--referencia-oms)" strokeDasharray="2 3" strokeWidth={1} />
                )}
                {/* La comparación va debajo y punteada: se distingue por el trazo además del color. */}
                {hayComparacion && (
                  <Line type="linear" dataKey="comparada" name={comparada.etiqueta} stroke="var(--serie-2)" strokeWidth={2}
                        strokeDasharray="6 3" connectNulls={false} dot={false}
                        activeDot={{ r: 5, stroke: "var(--papel)", strokeWidth: 2 }} isAnimationActive={false} />
                )}
                <Line type="linear" dataKey="valor" name={hayComparacion ? seleccionada?.etiqueta : nombre} stroke="var(--serie)"
                      strokeWidth={2} connectNulls={false}
                      dot={(props) => (props.payload?.anomalia || validos.length >= 60 ? PuntoAnomalo(props)
                        : <circle key={props.index} cx={props.cx} cy={props.cy} r={4} fill="var(--serie)"
                                  stroke="var(--papel)" strokeWidth={2} />)}
                      activeDot={{ r: 5, stroke: "var(--papel)", strokeWidth: 2 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul className="referencias">
            <li>
              <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--serie)" strokeWidth="2" /></svg>
              {hayComparacion ? seleccionada?.etiqueta : `${nombre} medido`}
            </li>
            {hayComparacion && (
              <li>
                <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--serie-2)" strokeWidth="2" strokeDasharray="6 3" /></svg>
                {comparada.etiqueta}
              </li>
            )}
            {anomalos > 0 && (
              <li>
                <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="var(--papel)" stroke="var(--anomalia)" strokeWidth="2" /></svg>
                Valor señalado como anómalo (Isolation Forest): error del sensor o evento real, sin modificar
              </li>
            )}
            {verAceptable && (
              <li>
                <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--referencia-ica)" strokeDasharray="5 4" /></svg>
                Fin de la categoría Aceptable del ICA ({limiteAceptable} µg/m³, {textoVentana(ventana)})
              </li>
            )}
            {verOms && (
              <li>
                <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--referencia-oms)" strokeDasharray="2 3" /></svg>
                Guía de la OMS ({formatearNumero(guiaOms)} µg/m³, promedio de {periodoOms})
              </li>
            )}
          </ul>
          <p className="resumen">
            Los huecos de la línea son {unidad} sin dato{marcados > 0 && " o con datos marcados como no confiables (el sensor repite el mismo valor o el valor es imposible), que tampoco entran en las cifras"}:
            se dejan vacíos y no se rellenan.
            {hayComparacion && ` La comparación se muestra en los mismos ${unidad} de la serie principal.`}
            {(verAceptable || verOms) &&
              " Cada línea de referencia corresponde al periodo que indica su clave, no necesariamente al de la gráfica."}
            {validos.length > 0 && ((limiteAceptable != null && !verAceptable) || (guiaOms != null && !verOms)) &&
              ` Las referencias de la norma o de la OMS que superan el doble del valor máximo del periodo no se dibujan${
                limiteAceptable != null ? ` (fin de "Aceptable" en el ICA: ${formatearNumero(limiteAceptable)} µg/m³)` : ""}.`}
          </p>
          <CicloDiario puntos={puntos} nombre={nombre} unidad={unidadMedida} parametro={parametro} agregacion={agregacion} />
          <div className="acciones">
            <a className="boton" href={api.urlCsv(estacionId, consulta)} download>Descargar los datos en CSV</a>
            {hayComparacion && (
              <a className="boton" href={api.urlCsv(comparada.id, consulta)} download>Descargar la comparación en CSV</a>
            )}
            <a className="boton" href={api.urlSerie(estacionId, consulta)} target="_blank" rel="noreferrer">Abrir en la API</a>
            <button className="boton texto" type="button" aria-expanded={verTabla} onClick={() => setVerTabla(!verTabla)}>
              {verTabla ? "Ocultar la tabla" : "Ver los datos como tabla"}
            </button>
          </div>
          {verTabla && (
            <div className="tabla-datos">
              <table>
                <thead><tr><th scope="col">{agregacion === "hora" ? "Fecha y hora" : "Día"}</th><th scope="col">Valor ({unidadMedida})</th>
                  {hayComparacion && <th scope="col">{comparada.etiqueta} ({unidadMedida})</th>}
                  {agregacion === "hora" && <th scope="col">Anómalo</th>}</tr></thead>
                <tbody>
                  {puntos.map((p) => (
                    <tr key={p.t}>
                      <td>{formatearFecha(fechaEje(p.t), agregacion === "hora")}</td>
                      <td className="numero">{p.marcado ? `${formatearNumero(p.marcado.valor)} (no confiable: ${p.marcado.motivo})`
                        : p.valor == null ? "sin dato" : formatearNumero(p.valor)}</td>
                      {hayComparacion && <td className="numero">{p.comparada == null ? "sin dato" : formatearNumero(p.comparada)}</td>}
                      {agregacion === "hora" && <td>{p.anomalia ? `Sí, puntaje ${formatearPuntaje(p.puntaje)}` : ""}</td>}
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
