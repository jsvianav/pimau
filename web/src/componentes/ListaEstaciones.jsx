import { estadoMasReciente } from "../util.js";

// Alternativa accesible al mapa: todas las estaciones se pueden elegir con el teclado.
export default function ListaEstaciones({ grupos, parametro, seleccion, onSeleccionar }) {
  return (
    <section className="lista">
      <h2>Estaciones</h2>
      <ul>
        {grupos.map((g) => {
          const actual = estadoMasReciente(g, parametro);
          const anio = actual?.estado.instante_ica?.slice(0, 4);
          return (
            <li key={g.id}>
              <button aria-pressed={g.id === seleccion} onClick={() => onSeleccionar(g.id)}>
                <span className="punto" style={{ background: actual?.estado.color || "var(--sin-ica)" }} aria-hidden="true" />
                <span>{g.nombre}</span>
                <span className="estado">
                  {actual?.estado.categoria ? `${actual.estado.categoria}, ${anio}` : actual ? "Sin ICA" : "Sin datos"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
