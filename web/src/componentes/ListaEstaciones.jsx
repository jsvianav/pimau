import { useState } from "react";
import { antiguedadCorta, claveEstacion, estadoMasReciente, formatearNumero, ultimoDatoDelGrupo } from "../util.js";

// Alternativa accesible al mapa: todas las estaciones se pueden elegir con el teclado.
function textoEstado(actual, meta, opciones) {
  if (!actual) return "Sin datos";
  // Para los datos recientes interesa cuántas horas tiene el dato; para el histórico, el año.
  const cuando = opciones.soloRecientes ? antiguedadCorta(actual.estado.instante, opciones.ahora) : actual.estado.instante.slice(0, 4);
  if (!meta?.ventana_ica_horas) {
    return `${formatearNumero(actual.estado.valor_horario)} ${meta?.unidad || ""}, ${cuando}`;
  }
  return actual.estado.categoria ? `${actual.estado.categoria}, ${cuando}` : "Sin ICA";
}

function Elemento({ grupo, parametro, meta, seleccion, onSeleccionar, opciones }) {
  const actual = estadoMasReciente(grupo, parametro, opciones);
  const ultimo = ultimoDatoDelGrupo(grupo);
  const marcada = grupo.registros.some((r) => r.parametros[parametro]?.ultima_marcada);
  const color = !actual ? "transparent" : meta?.ventana_ica_horas ? actual.estado.color || "var(--sin-ica)" : "var(--serie)";
  return (
    <li>
      <button type="button" aria-pressed={grupo.id === seleccion} onClick={() => onSeleccionar(grupo.id)}>
        <span className={`punto${actual ? "" : " hueco"}`} aria-hidden="true" style={{ background: color }} />
        {/* Nombre y estado comparten renglón si caben; si no, el estado baja al
            siguiente. Con «Dañina a la salud de grupos sensibles» en una sola
            columna fija, el nombre quedaba sin ancho y se dibujaba encima. */}
        <span className="texto-estacion">
          <span>{grupo.nombre}</span>
          <span className="estado">
            {actual || !opciones.soloRecientes ? textoEstado(actual, meta, opciones)
              : marcada ? "Datos no confiables" : ultimo ? `Último dato: ${ultimo.slice(0, 4)}` : "Sin datos"}
          </span>
        </span>
      </button>
    </li>
  );
}

// Mientras llegan las estaciones, filas grises con la forma de la lista: el panel
// no salta cuando aparecen. La ficha anuncia la carga al lector de pantalla.
function Esqueleto() {
  return (
    <section className="lista" aria-hidden="true">
      <span className="esqueleto esqueleto-titulo" />
      <ul>{[62, 48, 70, 55, 66, 44].map((ancho) => (
        <li key={ancho} className="esqueleto-fila"><span className="esqueleto esqueleto-punto" />
          <span className="esqueleto" style={{ width: `${ancho}%` }} /></li>
      ))}</ul>
    </section>
  );
}

function Grupo({ titulo, grupos, separado, ...props }) {
  if (!grupos.length) return null;
  return (
    <>
      <h3 className={separado ? "separado" : undefined}>{titulo} ({grupos.length})</h3>
      <ul>{grupos.map((g) => <Elemento key={g.id} grupo={g} {...props} />)}</ul>
    </>
  );
}

export default function ListaEstaciones({ grupos, parametro, meta, seleccion, onSeleccionar, opciones, carga = "listo" }) {
  const [busqueda, setBusqueda] = useState("");
  if (carga === "cargando") return <Esqueleto />;
  const props = { parametro, meta, seleccion, onSeleccionar, opciones };
  // La búsqueda ignora tildes, mayúsculas y palabras como «de» o «la», igual que
  // la regla que agrupa las estaciones de dos fuentes.
  // Una búsqueda hecha solo de esas palabras se compara tal cual: no debe
  // quedar ignorada en silencio.
  const consulta = busqueda.trim();
  const clave = claveEstacion(consulta) || consulta.toLowerCase();
  const visibles = consulta ? grupos.filter((g) => claveEstacion(g.nombre).includes(clave)) : grupos;
  const conRecientes = opciones.soloRecientes ? visibles.filter((g) => estadoMasReciente(g, parametro, opciones)) : [];
  const sinRecientes = visibles.filter((g) => !conRecientes.includes(g));

  return (
    // Destino del enlace «Saltar a la lista de estaciones» (App.jsx).
    <section className="lista" id="lista-estaciones" tabIndex={-1} aria-labelledby="titulo-lista">
      <h2 id="titulo-lista">Estaciones</h2>
      {grupos.length > 0 && (
        <div className="buscar-estacion">
          <label htmlFor="buscar-estacion">Buscar una estación</label>
          <input id="buscar-estacion" type="search" value={busqueda} autoComplete="off" enterKeyHint="search"
                 placeholder="Pance, Cañaveralejo…" onChange={(e) => setBusqueda(e.target.value)} />
        </div>
      )}
      <p className="solo-lector" role="status">
        {consulta ? `${visibles.length} ${visibles.length === 1 ? "estación coincide" : "estaciones coinciden"}` : ""}
      </p>
      {consulta && !visibles.length && (
        <div className="sin-resultados">
          <p>Ninguna estación coincide con «{busqueda.trim()}».</p>
          <button className="boton" type="button" onClick={() => setBusqueda("")}>Borrar la búsqueda</button>
        </div>
      )}
      {opciones.soloRecientes ? (
        <>
          <Grupo titulo="Con datos de las últimas 48 horas" grupos={conRecientes} {...props} />
          <Grupo titulo="Sin datos recientes de esta variable" grupos={sinRecientes} separado={conRecientes.length > 0}
                 {...props} />
        </>
      ) : (
        <ul>{visibles.map((g) => <Elemento key={g.id} grupo={g} {...props} />)}</ul>
      )}
    </section>
  );
}
