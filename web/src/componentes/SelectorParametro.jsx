import { PARAMETROS } from "../util.js";

const GRUPOS = [
  { variable: "calidad_aire", nombre: "Contaminantes" },
  { variable: "meteorologia", nombre: "Meteorología" },
  { variable: "ruido", nombre: "Ruido" },
];

// Con `corto`, cada opción lleva el nombre corto (PM2.5, PM10, O₃…). En la
// tarjeta del mapa no cabe el nombre completo: «Material particulado PM2.5» y
// «Material particulado PM10» se veían iguales con el selector cerrado. El
// nombre completo va en la leyenda.
export default function SelectorParametro({ parametros, valor, onCambiar, corto = false }) {
  return (
    <select value={valor} onChange={(e) => onCambiar(e.target.value)}>
      {GRUPOS.map((g) => {
        const opciones = parametros.filter((p) => p.variable === g.variable);
        if (!opciones.length) return null;
        return (
          <optgroup key={g.variable} label={g.nombre}>
            {opciones.map((p) => (
              <option key={p.codigo} value={p.codigo}>{corto ? PARAMETROS[p.codigo] || p.nombre : p.nombre}</option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
