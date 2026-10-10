import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { agruparEstaciones, formatearFecha, PARAMETROS } from "./util.js";
import Mapa from "./componentes/Mapa.jsx";
import Ficha from "./componentes/Ficha.jsx";
import ListaEstaciones from "./componentes/ListaEstaciones.jsx";
import Leyenda from "./componentes/Leyenda.jsx";
import Historico from "./componentes/Historico.jsx";

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
  const [error, setError] = useState(null);
  const [seleccion, setSeleccion] = useState(null);
  const [destinoHistorico, setDestinoHistorico] = useState(null);
  const panel = useRef(null);

  // Al elegir una estación, la ficha se muestra desde el inicio.
  useEffect(() => { panel.current?.scrollTo({ top: 0 }); }, [seleccion]);

  useEffect(() => {
    Promise.all([api.estaciones(), api.umbrales()])
      .then(([estaciones, limites]) => { setDatos(estaciones); setUmbrales(limites); })
      .catch((e) => setError(e.message));
  }, []);

  const grupos = useMemo(() => (datos ? agruparEstaciones(datos) : []), [datos]);
  // Fecha del dato más reciente entre todas las fuentes, para dar contexto.
  const ultimoDato = useMemo(() => {
    const fechas = (datos?.features || []).flatMap((f) => Object.values(f.properties.parametros).map((p) => p.instante));
    return fechas.length ? fechas.sort().at(-1) : null;
  }, [datos]);
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

      {ultimoDato && (
        <p className="contexto">
          Los datos abiertos de calidad del aire de Cali llegan hasta el {formatearFecha(ultimoDato, false)}. Cada
          estación muestra la fecha de su último dato y la fuente que lo publicó.
        </p>
      )}
      {error && <p className="aviso error" role="alert">No fue posible cargar los datos: {error}</p>}

      {pestana === "mapa" && (
        <main className="vista-mapa">
          <div className="mapa-contenedor">
            <Mapa grupos={grupos} parametro={parametro} seleccion={seleccion} onSeleccionar={setSeleccion}>
              <label className="campo">
                Contaminante
                <select value={parametro} onChange={(e) => setParametro(e.target.value)}>
                  {Object.entries(PARAMETROS).map(([codigo, nombre]) => <option key={codigo} value={codigo}>{nombre}</option>)}
                </select>
              </label>
            </Mapa>
            {umbrales && <Leyenda umbrales={umbrales} parametro={parametro} />}
          </div>
          <aside className="panel-lateral" ref={panel}>
            <Ficha grupo={grupoSeleccionado} parametro={parametro} onVerHistorico={verHistorico} />
            <ListaEstaciones grupos={grupos} parametro={parametro} seleccion={seleccion} onSeleccionar={setSeleccion} />
          </aside>
        </main>
      )}

      {pestana === "historico" && (
        <main className="vista-historico">
          <Historico grupos={grupos} umbrales={umbrales} destino={destinoHistorico} />
        </main>
      )}

      <footer className="pie">
        Datos del IDEAM (datos.gov.co), del Portal de Datos Abiertos de Cali (DAGMA) y de la IDESC. Mapa base de
        OpenFreeMap con datos de OpenStreetMap. Los datos se pueden consultar en la{" "}
        <a href="/api/docs">documentación de la API</a>.
      </footer>
    </div>
  );
}
