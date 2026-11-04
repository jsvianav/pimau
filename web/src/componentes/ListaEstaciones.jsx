import { antiguedadCorta, estadoMasReciente, formatearNumero, ultimoDatoDelGrupo } from "../util.js";

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

export default function ListaEstaciones({ grupos, parametro, meta, seleccion, onSeleccionar, opciones, carga = "listo" }) {
  if (carga === "cargando") return <Esqueleto />;
  const props = { parametro, meta, seleccion, onSeleccionar, opciones };
  if (!opciones.soloRecientes) {
    return (
      <section className="lista">
        <h2>Estaciones</h2>
        <ul>{grupos.map((g) => <Elemento key={g.id} grupo={g} {...props} />)}</ul>
      </section>
    );
  }
  const conRecientes = grupos.filter((g) => estadoMasReciente(g, parametro, opciones));
  const sinRecientes = grupos.filter((g) => !conRecientes.includes(g));
  return (
    <section className="lista">
      {conRecientes.length > 0 && (
        <>
          <h2>Con datos de las últimas 48 horas ({conRecientes.length})</h2>
          <ul>{conRecientes.map((g) => <Elemento key={g.id} grupo={g} {...props} />)}</ul>
        </>
      )}
      {sinRecientes.length > 0 && (
        <>
          <h2 className={conRecientes.length ? "separado" : undefined}>
            Sin datos recientes de esta variable ({sinRecientes.length})
          </h2>
          <ul>{sinRecientes.map((g) => <Elemento key={g.id} grupo={g} {...props} />)}</ul>
        </>
      )}
    </section>
  );
}
