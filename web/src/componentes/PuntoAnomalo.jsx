// Las mediciones anómalas (RF-13) se marcan sobre la línea con un punto hueco.
// Recharts lo llama como función para dibujar cada punto de la serie; vive
// aparte para que el Histórico y la ficha lo compartan sin importarse entre sí.
export default function PuntoAnomalo({ cx, cy, payload, index }) {
  if (!payload?.anomalia || cx == null || cy == null) return <g key={index} />;
  return <circle key={index} cx={cx} cy={cy} r={5} fill="var(--papel)" stroke="var(--anomalia)" strokeWidth={2} />;
}
