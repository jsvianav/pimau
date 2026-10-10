import { PARAMETROS } from "../util.js";

export default function Leyenda({ umbrales, parametro }) {
  const cortes = umbrales[parametro]?.ica || [];
  return (
    <section className="flotante leyenda" aria-label="Leyenda del Índice de Calidad del Aire">
      <h2>Índice de Calidad del Aire</h2>
      <p>{PARAMETROS[parametro]}, promedio de 24 horas, según la Resolución 2254 de 2017.</p>
      <ol>
        {cortes.map((c) => (
          <li key={c.categoria}>
            <span className="punto" style={{ background: c.color }} aria-hidden="true" />
            <span>{c.categoria}</span>
            <small>{c.inferior}–{c.superior}</small>
          </li>
        ))}
        <li>
          <span className="punto" style={{ background: "var(--sin-ica)" }} aria-hidden="true" />
          <span>Sin datos suficientes</span>
          <small />
        </li>
      </ol>
    </section>
  );
}
