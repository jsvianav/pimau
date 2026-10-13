import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { agruparEstaciones, formatearFecha } from "./util.js";
import SelectorParametro from "./componentes/SelectorParametro.jsx";
import Mapa from "./componentes/Mapa.jsx";
import Ficha from "./componentes/Ficha.jsx";
import ListaEstaciones from "./componentes/ListaEstaciones.jsx";
import Leyenda from "./componentes/Leyenda.jsx";
import Historico from "./componentes/Historico.jsx";

const CLAVE_AVISO = "pimau.aviso-datos-cerrado";

// Preferencia del navegador: si el almacenamiento no está disponible
// (navegación privada, por ejemplo), el aviso simplemente vuelve a aparecer.
function avisoCerrado() {
  try { return window.localStorage.getItem(CLAVE_AVISO) === "1"; } catch { return false; }
}

const PESTANAS = [
  { id: "mapa", nombre: "Mapa" },
  { id: "historico", nombre: "Histórico" },
  { id: "admin", nombre: "Administración", deshabilitada: true, nota: "Incremento 3" },
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
  const [mostrarAviso, setMostrarAviso] = useState(() => !avisoCerrado());
  const panel = useRef(null);

  // Al elegir una estación, la ficha se muestra desde el inicio.
  useEffect(() => { panel.current?.scrollTo({ top: 0 }); }, [seleccion]);

  useEffect(() => {
    Promise.all([api.estaciones(), api.umbrales(), api.parametros()])
      .then(([estaciones, limites, lista]) => {
        setDatos(estaciones); setUmbrales(limites); setParametros(lista.filter((p) => p.con_datos));
      })
      .catch((e) => setError(e.message));
  }, []);

  const grupos = useMemo(() => (datos ? agruparEstaciones(datos) : []), [datos]);
  const meta = useMemo(() => Object.fromEntries(parametros.map((p) => [p.codigo, p])), [parametros]);
  // Fecha del dato más reciente entre todas las fuentes, para dar contexto.
  const ultimoDato = useMemo(() => {
    const fechas = (datos?.features || []).flatMap((f) => Object.values(f.properties.parametros).map((p) => p.instante));
    return fechas.length ? fechas.sort().at(-1) : null;
  }, [datos]);
  const grupoSeleccionado = grupos.find((g) => g.id === seleccion) || null;

  function cerrarAviso() {
    setMostrarAviso(false);
    try { window.localStorage.setItem(CLAVE_AVISO, "1"); } catch { /* sin almacenamiento */ }
  }

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
                  onZonas={setZonas}>
              <label className="campo">
                Variable
                <SelectorParametro parametros={parametros} valor={parametro} onCambiar={setParametro} />
              </label>
            </Mapa>
            {ultimoDato && mostrarAviso && (
              <div className="contexto" role="note">
                <p>
                  Datos abiertos disponibles hasta el {formatearFecha(ultimoDato, false)}. Cada estación muestra la
                  fecha de su último dato.
                </p>
                <button className="cerrar" onClick={cerrarAviso} aria-label="Cerrar el aviso sobre la fecha de los datos">
                  <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
                    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            )}
            {umbrales && <Leyenda umbrales={umbrales} parametro={parametro} meta={meta[parametro]} />}
          </div>
          <aside className="panel-lateral" ref={panel}>
            <Ficha grupo={grupoSeleccionado} parametro={parametro} meta={meta[parametro]} zonas={zonas}
                   onVerHistorico={verHistorico} />
            <ListaEstaciones grupos={grupos} parametro={parametro} meta={meta[parametro]} seleccion={seleccion} onSeleccionar={setSeleccion} />
            <p className="fuentes">
              Datos del IDEAM, del portal de Datos Abiertos de Cali (DAGMA) y de la IDESC.{" "}
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

      {pestana !== "mapa" && (
        <footer className="pie">
          Datos del IDEAM (datos.gov.co), del Portal de Datos Abiertos de Cali (DAGMA) y de la IDESC. Mapa base de
          OpenFreeMap con datos de OpenStreetMap. Los datos se pueden consultar en la{" "}
          <a href="/api/docs">documentación de la API</a>.
        </footer>
      )}
    </div>
  );
}
