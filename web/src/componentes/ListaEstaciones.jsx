import { estadoMasReciente } from "../util.js";

// Alternativa accesible al mapa: todas las estaciones se pueden elegir con el teclado.
export default function ListaEstaciones({ grupos, parametro, seleccion, onSeleccionar }) {
  return (
    <section className="lista">
      <h2>Lista de estaciones</h2>
      <ul>
        {grupos.map((g) => {
          const actual = estadoMasReciente(g, parametro);
          return (
            <li key={g.id}>
              <button aria-pressed={g.id === seleccion} onClick={() => onSeleccionar(g.id)}>
                <span className="punto" style={{ background: actual?.estado.color || "#9aa3ad" }} aria-hidden="true" />
                <span className="nombre">{g.nombre}</span>
                <span className="estado">{actual ? actual.estado.categoria || "Sin ICA" : "Sin datos"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
