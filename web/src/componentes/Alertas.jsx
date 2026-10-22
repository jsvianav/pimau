import { formatearNumero, fechaCorta, nombreCorto } from "../util.js";

// Alertas activas (RF-14): estaciones cuya última medición, de las últimas
// horas, iguala o supera el umbral que configuró el administrador. Elegir una
// alerta abre la estación con la variable de la alerta.
export default function Alertas({ alertas, grupos, ahora, onElegir }) {
  if (!alertas.length) return null;
  return (
    <section className="alertas" aria-labelledby="titulo-alertas">
      <h2 id="titulo-alertas">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1.5 15 14H1z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M8 6v3.6M8 11.6v.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {alertas.length === 1 ? "1 alerta activa" : `${alertas.length} alertas activas`}
      </h2>
      <ul>
        {alertas.map((a) => {
          const grupo = grupos.find((g) => g.registros.some((r) => r.id === a.estacion_id));
          return (
            <li key={`${a.estacion_id}-${a.parametro}`}>
              <button onClick={() => grupo && onElegir(grupo.id, a.parametro)}>
                <span>{grupo?.nombre || a.estacion}</span>
                <span className="alerta-detalle">
                  {nombreCorto(a.parametro)}: {formatearNumero(a.valor)} {a.unidad} (umbral {formatearNumero(a.umbral)}),{" "}
                  {fechaCorta(a.instante, ahora)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
