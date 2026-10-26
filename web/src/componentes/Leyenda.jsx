import { formatearNumero, nombreCorto, textoVentana } from "../util.js";
import { COLOR_ALERTA } from "./Mapa.jsx";

// Anillos que pueden rodear una estación, con cualquier variable.
function Anillos() {
  return (
    <ul className="anillos">
      <li><span className="anillo" style={{ borderColor: COLOR_ALERTA, borderWidth: 3 }} aria-hidden="true" />
        Alerta activa (supera el umbral)</li>
      <li><span className="anillo anomalia" aria-hidden="true" />
        Último dato anómalo</li>
    </ul>
  );
}

// Sobre el mapa flota en una tarjeta; en el celular, donde no cabe, va dentro
// del panel (variante "panel").
export default function Leyenda({ umbrales, parametro, meta, soloRecientes, variante = "flotante" }) {
  const clase = variante === "panel" ? "leyenda leyenda-panel" : "flotante leyenda";
  const cortes = umbrales[parametro]?.ica || [];
  const ruido = umbrales[parametro]?.ruido || {};
  if (ruido["Día"]) {
    return (
      <section className={clase} aria-label="Leyenda del ruido">
        <h2>{meta?.nombre || "Ruido ambiental"}</h2>
        <p>
          Nivel equivalente de cada hora, en dB(A). La Resolución 627 de 2006 fija para zonas residenciales,
          universidades y colegios (sector B) {formatearNumero(ruido["Día"])} dB(A) de día y{" "}
          {formatearNumero(ruido["Noche"])} de noche. El límite exacto depende del uso del suelo de cada sitio.
        </p>
        <Anillos />
      </section>
    );
  }
  if (!cortes.length) {
    return (
      <section className={clase} aria-label="Leyenda">
        <h2>{meta?.nombre || nombreCorto(parametro)}</h2>
        <p>
          {meta?.variable === "meteorologia"
            ? "Variable meteorológica: no tiene escala de calidad del aire."
            : "Este contaminante no tiene puntos de corte en la Resolución 2254 de 2017."}{" "}
          El último valor aparece junto a cada estación, en {meta?.unidad}.
        </p>
        <Anillos />
      </section>
    );
  }
  return (
    <section className={clase} aria-label="Leyenda del Índice de Calidad del Aire">
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
          <span>Sin datos suficientes para el ICA</span>
          <small />
        </li>
        <li>
          <span className="punto hueco" aria-hidden="true" />
          <span>{soloRecientes ? "Sin datos de las últimas 48 horas" : "Sin datos"}</span>
          <small />
        </li>
      </ol>
      <Anillos />
      <p className="nota-zonas">
        La comuna o el corregimiento de cada estación toma su color. El dato es de la estación, no una medición de
        toda la zona.
      </p>
    </section>
  );
}
