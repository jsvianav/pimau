import { PARAMETROS } from "../util.js";

export default function Leyenda({ umbrales, parametro }) {
  const cortes = umbrales[parametro]?.ica || [];
  return (
    <div className="leyenda" aria-label="Leyenda del Índice de Calidad del Aire">
      <strong>ICA {PARAMETROS[parametro]} (Res. 2254 de 2017, promedio 24 h)</strong>
      <ul>
        {cortes.map((c) => (
          <li key={c.categoria}>
            <span className="punto" style={{ background: c.color }} aria-hidden="true" />
            {c.categoria} <small>{c.inferior}–{c.superior} µg/m³</small>
          </li>
        ))}
        <li><span className="punto" style={{ background: "#9aa3ad" }} aria-hidden="true" />Sin ICA (datos insuficientes)</li>
      </ul>
    </div>
  );
}
