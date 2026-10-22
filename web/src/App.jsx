import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { agruparEstaciones, esReciente, estadoMasReciente, fechaCorta, nombreCorto, ultimoDatoDelGrupo } from "./util.js";
import SelectorParametro from "./componentes/SelectorParametro.jsx";
import Mapa from "./componentes/Mapa.jsx";
import Ficha from "./componentes/Ficha.jsx";
import ListaEstaciones from "./componentes/ListaEstaciones.jsx";
import Leyenda from "./componentes/Leyenda.jsx";
import Historico from "./componentes/Historico.jsx";
import Administracion from "./componentes/Administracion.jsx";

// SATIC se descarga cada hora y la API renueva su caché cada nueve minutos, así
// que el visor vuelve a pedir las estaciones cada diez minutos.
const MINUTOS_ACTUALIZACION = 10;

const PESTANAS = [
  { id: "mapa", nombre: "Mapa" },
  { id: "historico", nombre: "Histórico" },
  { id: "admin", nombre: "Administración" },
];

export default function App() {
  const [pestana, setPestana] = useState("mapa");
  const [parametro, setParametro] = useState("PM25");
  const [datos, setDatos] = useState(null);
  const [umbrales, setUmbrales] = useState(null);
  const [parametros, setParametros] = useState([]);
  const [error, setError] = useState(null);
  const [seleccion, setSeleccion] = useState(null);
  const [destinoHistorico, setDestinoHistorico] = useState(null);
  const [zonas, setZonas] = useState(null);
  // Por defecto el mapa muestra solo lo medido en las últimas 48 horas, para no
  // pintar con el mismo color un dato de hoy y uno de hace años.
  const [soloRecientes, setSoloRecientes] = useState(true);
  const [ahora, setAhora] = useState(() => new Date());
  const panel = useRef(null);

  // Al elegir una estación, la ficha se muestra desde el inicio.
  useEffect(() => { panel.current?.scrollTo({ top: 0 }); }, [seleccion]);

  useEffect(() => {
    Promise.all([api.estaciones(), api.umbrales(), api.parametros()])
      .then(([estaciones, limites, lista]) => {
        setDatos(estaciones); setUmbrales(limites); setParametros(lista.filter((p) => p.con_datos));
      })
      .catch((e) => setError(e.message));
    const intervalo = setInterval(() => {
      // Si una actualización falla se conservan los datos que ya se muestran.
      api.estaciones().then((estaciones) => { setDatos(estaciones); setAhora(new Date()); }).catch(() => {});
    }, MINUTOS_ACTUALIZACION * 60000);
    return () => clearInterval(intervalo);
  }, []);

  const grupos = useMemo(() => (datos ? agruparEstaciones(datos) : []), [datos]);
  const meta = useMemo(() => Object.fromEntries(parametros.map((p) => [p.codigo, p])), [parametros]);
  // Fecha del dato más reciente entre todas las fuentes, para dar contexto.
  const ultimoDato = useMemo(() => grupos.map(ultimoDatoDelGrupo).filter(Boolean).sort().at(-1) || null, [grupos]);
  const recientes = useMemo(
    () => grupos.filter((g) => estadoMasReciente(g, parametro, { soloRecientes: true, ahora })).length,
    [grupos, parametro, ahora]);
  const opcionesEstado = useMemo(() => ({ soloRecientes, ahora }), [soloRecientes, ahora]);
  const grupoSeleccionado = grupos.find((g) => g.id === seleccion) || null;

  function verHistorico(estacionId) {
    setDestinoHistorico({ estacionId, parametro });
    setPestana("historico");
  }

  return (
    <div className="aplicacion">
      <header className="encabezado">
        <div className="marca">
          <h1>PIMAU</h1>
          <p>Calidad del aire en Santiago de Cali</p>
        </div>
        <nav className="pestanas" aria-label="Secciones">
          {PESTANAS.map((p) => (
            <button key={p.id} className="pestana" aria-current={pestana === p.id ? "page" : undefined}
                    disabled={p.deshabilitada} title={p.nota} onClick={() => setPestana(p.id)}>
              {p.nombre}
            </button>
          ))}
        </nav>
      </header>

      {error && <p className="aviso error" role="alert">No fue posible cargar los datos: {error}</p>}

      {pestana === "mapa" && (
        <main className="vista-mapa">
          <div className="mapa-contenedor">
            <Mapa grupos={grupos} parametro={parametro} meta={meta[parametro]} seleccion={seleccion} onSeleccionar={setSeleccion}
                  onZonas={setZonas} opciones={opcionesEstado}>
              <label className="campo">
                Variable
                <SelectorParametro parametros={parametros} valor={parametro} onCambiar={setParametro} />
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
            {ultimoDato && (
              <div className={`contexto${soloRecientes && !recientes ? " sin-recientes" : ""}`} role="status">
                {soloRecientes && !recientes ? (
                  <>
                    <p>Ninguna estación tiene {nombreCorto(parametro)} de las últimas 48 horas.</p>
                    <button className="enlace" onClick={() => setSoloRecientes(false)}>Ver todo el histórico</button>
                  </>
                ) : !soloRecientes ? (
                  <p>Todo el histórico: cada estación muestra su último dato, que puede ser de hace años.</p>
                ) : (
                  <p>
                    <span className={`pulso${esReciente(ultimoDato, ahora) ? "" : " apagado"}`} aria-hidden="true" />
                    {recientes} {recientes === 1 ? "estación" : "estaciones"} con {nombreCorto(parametro)} de las últimas
                    48 horas · último dato {fechaCorta(ultimoDato, ahora)}
                  </p>
                )}
              </div>
            )}
            {umbrales && <Leyenda umbrales={umbrales} parametro={parametro} meta={meta[parametro]} soloRecientes={soloRecientes} />}
          </div>
          <aside className="panel-lateral" ref={panel}>
            <Ficha grupo={grupoSeleccionado} parametro={parametro} meta={meta[parametro]} zonas={zonas}
                   onVerHistorico={verHistorico} ahora={ahora} />
            <ListaEstaciones grupos={grupos} parametro={parametro} meta={meta[parametro]} seleccion={seleccion}
                             onSeleccionar={setSeleccion} opciones={opcionesEstado} />
            <p className="fuentes">
              Datos del IDEAM, del portal de Datos Abiertos de Cali (DAGMA), de SATIC (red OAC22) y de la IDESC.{" "}
              <a href="/api/docs">Documentación de la API</a>.
            </p>
          </aside>
        </main>
      )}

      {pestana === "historico" && (
        <main className="vista-historico">
          <Historico grupos={grupos} umbrales={umbrales} parametros={parametros} meta={meta} destino={destinoHistorico} />
        </main>
      )}

      {pestana === "admin" && (
        <main className="vista-admin">
          <Administracion />
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
