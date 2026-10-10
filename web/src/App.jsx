import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { agruparEstaciones, PARAMETROS } from "./util.js";
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

  useEffect(() => {
    Promise.all([api.estaciones(), api.umbrales()])
      .then(([estaciones, limites]) => { setDatos(estaciones); setUmbrales(limites); })
      .catch((e) => setError(e.message));
  }, []);

  const grupos = useMemo(() => (datos ? agruparEstaciones(datos) : []), [datos]);
  const grupoSeleccionado = grupos.find((g) => g.id === seleccion) || null;

  function verHistorico(estacionId) {
    setDestinoHistorico({ estacionId, parametro });
    setPestana("historico");
  }

  return (
    <div className="aplicacion">
      <header className="encabezado">
        <h1>PIMAU <span>· Calidad del aire en Cali</span></h1>
        <nav aria-label="Secciones">
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
            <div className="controles-mapa">
              <label>
                Parámetro{" "}
                <select value={parametro} onChange={(e) => setParametro(e.target.value)}>
                  {Object.entries(PARAMETROS).map(([codigo, nombre]) => <option key={codigo} value={codigo}>{nombre}</option>)}
                </select>
              </label>
            </div>
            <Mapa grupos={grupos} parametro={parametro} seleccion={seleccion} onSeleccionar={setSeleccion} />
            {umbrales && <Leyenda umbrales={umbrales} parametro={parametro} />}
          </div>
          <aside className="panel-lateral">
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
        Fuentes: IDEAM (datos.gov.co), Portal de Datos Abiertos de Cali (DAGMA) e IDESC. Mapa base © OpenStreetMap,
        OpenFreeMap. Cada dato muestra su fecha y su fuente. <a href="/api/docs">Documentación de la API</a>
      </footer>
    </div>
  );
}
