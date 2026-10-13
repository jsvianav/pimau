import { nombreCorto, textoVentana } from "../util.js";

export default function Leyenda({ umbrales, parametro, meta }) {
  const cortes = umbrales[parametro]?.ica || [];
  if (!cortes.length) {
    return (
      <section className="flotante leyenda" aria-label="Leyenda">
        <h2>{meta?.nombre || nombreCorto(parametro)}</h2>
        <p>
          {meta?.variable === "meteorologia"
            ? "Variable meteorológica: no tiene escala de calidad del aire."
            : "Este contaminante no tiene puntos de corte en la Resolución 2254 de 2017."}{" "}
          El último valor aparece junto a cada estación, en {meta?.unidad}.
        </p>
      </section>
    );
  }
  return (
    <section className="flotante leyenda" aria-label="Leyenda del Índice de Calidad del Aire">
      <h2>Índice de Calidad del Aire</h2>
      <p>{nombreCorto(parametro)}, {textoVentana(meta?.ventana_ica_horas)}. Resolución 2254 de 2017, en µg/m³.</p>
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
      <p className="nota-zonas">
        La comuna o el corregimiento de cada estación toma su color. El dato es de la estación, no una medición de
        toda la zona.
      </p>
    </section>
  );
}
