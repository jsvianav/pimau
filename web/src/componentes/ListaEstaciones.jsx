import { estadoMasReciente, formatearNumero } from "../util.js";

// Alternativa accesible al mapa: todas las estaciones se pueden elegir con el teclado.
function textoEstado(actual, meta) {
  if (!actual) return "Sin datos";
  if (!meta?.ventana_ica_horas) {
    return `${formatearNumero(actual.estado.valor_horario)} ${meta?.unidad || ""}, ${actual.estado.instante.slice(0, 4)}`;
  }
  return actual.estado.categoria ? `${actual.estado.categoria}, ${actual.estado.instante_ica.slice(0, 4)}` : "Sin ICA";
}

export default function ListaEstaciones({ grupos, parametro, meta, seleccion, onSeleccionar }) {
  return (
    <section className="lista">
      <h2>Estaciones</h2>
      <ul>
        {grupos.map((g) => {
          const actual = estadoMasReciente(g, parametro);
          return (
            <li key={g.id}>
              <button aria-pressed={g.id === seleccion} onClick={() => onSeleccionar(g.id)}>
                <span className="punto" aria-hidden="true"
                      style={{ background: meta?.ventana_ica_horas ? actual?.estado.color || "var(--sin-ica)" : actual ? "var(--serie)" : "var(--sin-ica)" }} />
                <span>{g.nombre}</span>
                <span className="estado">{textoEstado(actual, meta)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
