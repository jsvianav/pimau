import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { agruparEstaciones, esReciente, estadoMasReciente, fechaCorta, nombreCorto, ultimoDatoDelGrupo } from "./util.js";
import SelectorParametro from "./componentes/SelectorParametro.jsx";
import Ficha from "./componentes/Ficha.jsx";
import ListaEstaciones from "./componentes/ListaEstaciones.jsx";
import Leyenda from "./componentes/Leyenda.jsx";
import Alertas from "./componentes/Alertas.jsx";
import AvisoError from "./componentes/AvisoError.jsx";
import { TEMAS_MAPA } from "./colores.js";
import { esNuevoPaso, escribirUrl, leerUrl, VARIABLE_INICIAL } from "./url.js";

// El mapa (MapLibre, unos 280 kB comprimidos) se descarga en paralelo: el panel
// se pinta y pide los datos sin esperarlo. El Histórico (con Recharts) y la
// Administración se descargan al abrir su pestaña.
const Mapa = lazy(() => import("./componentes/Mapa.jsx"));
const Historico = lazy(() => import("./componentes/Historico.jsx"));
const Administracion = lazy(() => import("./componentes/Administracion.jsx"));
const Acerca = lazy(() => import("./componentes/Acerca.jsx"));
const CARGANDO_VISTA = <p className="cargando" role="status">Cargando…</p>;

// SATIC se descarga cada hora y la API renueva su caché cada nueve minutos, así
// que el visor vuelve a pedir las estaciones cada diez minutos.
const MINUTOS_ACTUALIZACION = 10;

const PESTANAS = [
  { id: "mapa", nombre: "Mapa" },
  { id: "historico", nombre: "Histórico" },
  { id: "admin", nombre: "Administración" },
  { id: "acerca", nombre: "Acerca de" },
];

// Sigue la preferencia de modo claro u oscuro del sistema mientras la página está
// abierta. React exige que el nombre de un hook empiece por "use".
function useModoOscuro() {
  const [oscuro, setOscuro] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const consulta = window.matchMedia("(prefers-color-scheme: dark)");
    const alCambiar = () => setOscuro(consulta.matches);
    consulta.addEventListener("change", alCambiar);
    return () => consulta.removeEventListener("change", alCambiar);
  }, []);
  return oscuro;
}

// Lo que pide el Histórico al abrirse, a partir de la URL.
function destinoDesdeUrl(estado) {
  return estado.vista === "historico"
    ? { estacionId: estado.serie, parametro: estado.variable, desde: estado.desde, hasta: estado.hasta } : null;
}

export default function App() {
  // El estado inicial sale de la URL: un enlace abre la misma vista.
  const [inicial] = useState(() => leerUrl(window.location.search));
  const [pestana, setPestana] = useState(inicial.vista);
  const [parametroElegido, setParametro] = useState((inicial.vista === "mapa" && inicial.variable) || VARIABLE_INICIAL);
  const [datos, setDatos] = useState(null);
  const [umbrales, setUmbrales] = useState(null);
  const [parametros, setParametros] = useState([]);
  const [error, setError] = useState(null);
  const [seleccionElegida, setSeleccion] = useState(inicial.estacion ?? null);
  const [destinoHistorico, setDestinoHistorico] = useState(() => destinoDesdeUrl(inicial));
  // Última consulta del Histórico, para escribirla en la URL. Empieza con lo que
  // trae el enlace, para no borrarlo antes de que el Histórico consulte.
  const [consultaHistorico, setConsultaHistorico] = useState(() => destinoDesdeUrl(inicial));
  const [zonas, setZonas] = useState(null);
  // Por defecto el mapa muestra solo lo medido en las últimas 48 horas, para no
  // pintar con el mismo color un dato de hoy y uno de hace años.
  const [soloRecientes, setSoloRecientes] = useState(inicial.soloRecientes ?? true);
  const [ahora, setAhora] = useState(() => new Date());
  const [alertas, setAlertas] = useState([]);
  const oscuro = useModoOscuro();

  const grupos = useMemo(() => (datos ? agruparEstaciones(datos) : []), [datos]);
  const meta = useMemo(() => Object.fromEntries(parametros.map((p) => [p.codigo, p])), [parametros]);
  // En el mapa solo van los contaminantes con ICA y la meteorología. Un
  // contaminante sin escala del ICA (hoy, el sulfuro de hidrógeno, que además
  // solo tiene datos hasta 2020) no se puede colorear y queda en el Histórico.
  const parametrosMapa = useMemo(
    () => parametros.filter((p) => p.variable !== "calidad_aire" || p.ventana_ica_horas), [parametros]);
  // Un enlace viejo puede nombrar una variable o una estación que ya no existen:
  // cuando llegan los datos se ignoran, y la URL se corrige sola.
  const parametro = parametrosMapa.length && !parametrosMapa.some((p) => p.codigo === parametroElegido)
    ? VARIABLE_INICIAL : parametroElegido;
  const seleccion = datos && seleccionElegida && !grupos.some((g) => g.id === seleccionElegida) ? null : seleccionElegida;

  // Al elegir una estación, el foco pasa al nombre en la ficha: el lector de
  // pantalla lo anuncia y la ficha queda a la vista aunque haya alertas encima
  // o, en el celular, aunque vaya debajo del mapa.
  useEffect(() => {
    const titulo = seleccion == null ? null : document.getElementById("titulo-ficha");
    if (!titulo) return;
    titulo.focus({ preventScroll: true });
    const ancho = window.matchMedia("(min-width: 901px)").matches;
    const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    titulo.scrollIntoView({ block: ancho ? "start" : "nearest", behavior: sinMovimiento ? "auto" : "smooth" });
  }, [seleccion]);

  // La URL sigue al estado. Cambiar de pestaña o de estación agrega un paso al
  // historial (así funciona «Atrás»); lo demás reemplaza la dirección actual.
  const estadoAnterior = useRef(null);
  useEffect(() => {
    const estado = pestana === "mapa" ? { vista: "mapa", estacion: seleccion, variable: parametro, soloRecientes }
      : pestana === "historico" ? { vista: "historico", serie: consultaHistorico?.estacionId, variable: consultaHistorico?.parametro,
                                    desde: consultaHistorico?.desde, hasta: consultaHistorico?.hasta }
        : { vista: pestana };
    const destino = escribirUrl(estado);
    if (destino !== window.location.search) {
      const metodo = esNuevoPaso(estadoAnterior.current, estado) ? "pushState" : "replaceState";
      window.history[metodo](null, "", window.location.pathname + destino);
    }
    estadoAnterior.current = estado;
  }, [pestana, seleccion, parametro, soloRecientes, consultaHistorico]);

  // «Atrás» y «Adelante» restauran la vista que dice la URL.
  useEffect(() => {
    function alVolver() {
      const estado = leerUrl(window.location.search);
      estadoAnterior.current = null;
      setPestana(estado.vista);
      if (estado.vista === "mapa") {
        setSeleccion(estado.estacion ?? null);
        setParametro(estado.variable || VARIABLE_INICIAL);
        setSoloRecientes(estado.soloRecientes);
      }
      if (estado.vista === "historico") {
        setDestinoHistorico(destinoDesdeUrl(estado));
        setConsultaHistorico(destinoDesdeUrl(estado));
      }
    }
    window.addEventListener("popstate", alVolver);
    return () => window.removeEventListener("popstate", alVolver);
  }, []);

  // Cada sección tiene su propio título de página (WCAG 2.4.2).
  useEffect(() => {
    document.title = pestana === "mapa" ? "PIMAU · Calidad del aire en Cali"
      : `${PESTANAS.find((p) => p.id === pestana).nombre} · PIMAU`;
  }, [pestana]);

  function cargar() {
    Promise.all([api.estaciones(), api.umbrales(), api.parametros()])
      .then(([estaciones, limites, lista]) => {
        setDatos(estaciones); setUmbrales(limites); setParametros(lista.filter((p) => p.con_datos));
      })
      .catch((e) => setError(e));
    // Las alertas son un complemento: si fallan, el mapa funciona igual.
    api.alertas().then(setAlertas).catch(() => {});
  }

  function reintentar() {
    setError(null);
    cargar();
  }

  useEffect(() => {
    cargar();
    const intervalo = setInterval(() => {
      // Si una actualización falla se conservan los datos que ya se muestran.
      api.estaciones().then((estaciones) => { setDatos(estaciones); setAhora(new Date()); }).catch(() => {});
      api.alertas().then(setAlertas).catch(() => {});
    }, MINUTOS_ACTUALIZACION * 60000);
    return () => clearInterval(intervalo);
  }, []);

  // Fecha del dato más reciente entre todas las fuentes, para dar contexto.
  const ultimoDato = useMemo(() => grupos.map(ultimoDatoDelGrupo).filter(Boolean).sort().at(-1) || null, [grupos]);
  const recientes = useMemo(
    () => grupos.filter((g) => estadoMasReciente(g, parametro, { soloRecientes: true, ahora })).length,
    [grupos, parametro, ahora]);
  const opcionesEstado = useMemo(() => ({ soloRecientes, ahora }), [soloRecientes, ahora]);
  const grupoSeleccionado = grupos.find((g) => g.id === seleccion) || null;
  // Estado de la carga, para que la ficha no pida elegir una estación que no existe.
  const carga = error && !datos ? "error" : !datos ? "cargando" : grupos.length ? "listo" : "vacio";

  // Estado de los datos: va sobre el mapa en pantallas anchas y arriba del panel
  // en las demás, donde no cabe entre las tarjetas.
  const sinRecientes = soloRecientes && !recientes;
  const estadoDatos = ultimoDato && (sinRecientes ? (
    <>
      <p>Ninguna estación tiene {nombreCorto(parametro)} de las últimas 48 horas.</p>
      <button className="enlace" type="button" onClick={() => setSoloRecientes(false)}>Ver todo el histórico</button>
    </>
  ) : !soloRecientes ? (
    <p>Todo el histórico: cada estación muestra su último dato, que puede ser de hace años.</p>
  ) : (
    <p>
      <span className={`pulso${esReciente(ultimoDato, ahora) ? "" : " apagado"}`} aria-hidden="true" />
      {recientes} {recientes === 1 ? "estación" : "estaciones"} con {nombreCorto(parametro)} de las últimas
      48 horas · último dato {fechaCorta(ultimoDato, ahora)}
    </p>
  ));

  function elegirAlerta(grupoId, codigo) {
    setParametro(codigo);
    setSeleccion(grupoId);
  }

  function verHistorico(estacionId) {
    setDestinoHistorico({ estacionId, parametro });
    setConsultaHistorico({ estacionId, parametro });
    setPestana("historico");
  }

  // Al volver al Histórico por su pestaña se abre la última consulta.
  function cambiarPestana(id) {
    if (id === "historico" && pestana !== "historico" && consultaHistorico) setDestinoHistorico(consultaHistorico);
    setPestana(id);
  }

  // Enlace para saltar los controles del mapa (o el encabezado) con el teclado.
  // Sin estaciones (o si no cargaron) no hay lista: el salto lleva a la ficha, que
  // explica qué pasó y ofrece volver a cargar.
  const hayLista = carga === "listo" || carga === "cargando";
  const destinoSalto = pestana !== "mapa" ? "contenido" : hayLista ? "lista-estaciones" : "panel-lateral";
  function saltar(evento) {
    // Sin destino todavía (la lista está cargando) no se navega al #ancla: solo
    // agregaría un paso al historial.
    evento.preventDefault();
    document.getElementById(destinoSalto)?.focus();
  }

  return (
    <div className="aplicacion">
      <a className="saltar" href={`#${destinoSalto}`} onClick={saltar}>
        {pestana !== "mapa" ? "Saltar al contenido" : hayLista ? "Saltar a la lista de estaciones" : "Saltar al panel"}
      </a>
      <header className="encabezado">
        <div className="marca">
          <h1>PIMAU</h1>
          <p>Calidad del aire en Santiago de Cali</p>
        </div>
        <nav className="pestanas" aria-label="Secciones">
          {PESTANAS.map((p) => (
            <button key={p.id} type="button" className="pestana" aria-current={pestana === p.id ? "page" : undefined}
                    disabled={p.deshabilitada} title={p.nota} onClick={() => cambiarPestana(p.id)}>
              {p.nombre}
            </button>
          ))}
        </nav>
      </header>

      {error && <AvisoError titulo="No se pudieron cargar las estaciones." error={error} onReintentar={reintentar} />}

      {pestana === "mapa" && (
        <main className="vista-mapa">
          <div className="mapa-contenedor">
            {/* El mapa se vuelve a crear al pasar a modo oscuro, con el mapa base y los colores de ese modo.
                Mientras llega su archivo se ve el fondo del mapa, sin mover nada de la página. */}
            <Suspense fallback={<div className="mapa" />}>
              <Mapa key={oscuro ? "oscuro" : "claro"} tema={oscuro ? TEMAS_MAPA.oscuro : TEMAS_MAPA.claro}
                    grupos={grupos} parametro={parametro} meta={meta[parametro]} seleccion={seleccion} onSeleccionar={setSeleccion}
                    onZonas={setZonas} opciones={opcionesEstado} alertas={alertas}
                    leyenda={umbrales && <Leyenda umbrales={umbrales} parametro={parametro} meta={meta[parametro]}
                                                  soloRecientes={soloRecientes} />}>
                <label className="campo">
                  Variable
                  <SelectorParametro parametros={parametrosMapa} valor={parametro} onCambiar={setParametro} corto />
                </label>
                <fieldset className="selector-vigencia">
                  <legend>Mostrar</legend>
                  <label>
                    <input type="radio" name="vigencia" checked={soloRecientes} onChange={() => setSoloRecientes(true)} />
                    Datos recientes (48 horas)
                  </label>
                  <label>
                    <input type="radio" name="vigencia" checked={!soloRecientes} onChange={() => setSoloRecientes(false)} />
                    Todo el histórico
                  </label>
                </fieldset>
              </Mapa>
            </Suspense>
            {estadoDatos && (
              <div className={`contexto${sinRecientes ? " sin-recientes" : ""}`} role="status">{estadoDatos}</div>
            )}
          </div>
          <aside className="panel-lateral" id="panel-lateral" tabIndex={-1}>
            {estadoDatos && (
              <div className={`estado-panel${sinRecientes ? " sin-recientes" : ""}`} role="status">{estadoDatos}</div>
            )}
            <Alertas alertas={alertas} grupos={grupos} ahora={ahora} onElegir={elegirAlerta} />
            <Ficha grupo={grupoSeleccionado} parametro={parametro} meta={meta[parametro]} zonas={zonas}
                   onVerHistorico={verHistorico} ahora={ahora} alertas={alertas} umbrales={umbrales} carga={carga}
                   onReintentar={reintentar} />
            <ListaEstaciones grupos={grupos} parametro={parametro} meta={meta[parametro]} seleccion={seleccion}
                             onSeleccionar={setSeleccion} opciones={opcionesEstado} carga={carga} />
            {/* En el celular la leyenda va después de la lista y plegada (en pantallas anchas flota sobre el mapa). */}
            {umbrales && <Leyenda umbrales={umbrales} parametro={parametro} meta={meta[parametro]}
                                  soloRecientes={soloRecientes} variante="panel" />}
            <p className="fuentes">
              Datos del IDEAM, del portal de Datos Abiertos de Cali (DAGMA), de SATIC (red OAC22) y de la IDESC.{" "}
              <a href="/api/docs">Documentación de la API</a> ·{" "}
              <button className="enlace" type="button" onClick={() => cambiarPestana("acerca")}>Acerca de los datos</button>.
            </p>
          </aside>
        </main>
      )}

      {pestana === "historico" && (
        <main className="vista-historico" id="contenido" tabIndex={-1}>
          <Suspense fallback={CARGANDO_VISTA}>
            <Historico key={JSON.stringify(destinoHistorico)} grupos={grupos} umbrales={umbrales} parametros={parametros}
                       meta={meta} destino={destinoHistorico} onConsulta={setConsultaHistorico} />
          </Suspense>
        </main>
      )}

      {pestana === "admin" && (
        <main className="vista-admin" id="contenido" tabIndex={-1}>
          <Suspense fallback={CARGANDO_VISTA}>
            <Administracion />
          </Suspense>
        </main>
      )}

      {pestana === "acerca" && (
        <main className="vista-acerca" id="contenido" tabIndex={-1}>
          <Suspense fallback={CARGANDO_VISTA}>
            <Acerca />
          </Suspense>
        </main>
      )}

      {pestana !== "mapa" && (
        <footer className="pie">
          Datos del IDEAM (datos.gov.co), del Portal de Datos Abiertos de Cali (DAGMA), de SATIC (red OAC22) y de la IDESC. Mapa base de
          OpenFreeMap con datos de OpenStreetMap. Los datos se pueden consultar en la{" "}
          <a href="/api/docs">documentación de la API</a>.
        </footer>
      )}
    </div>
  );
}
