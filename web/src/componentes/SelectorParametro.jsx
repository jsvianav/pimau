const GRUPOS = [
  { variable: "calidad_aire", nombre: "Contaminantes" },
  { variable: "meteorologia", nombre: "Meteorología" },
  { variable: "ruido", nombre: "Ruido" },
];

export default function SelectorParametro({ parametros, valor, onCambiar }) {
  return (
    <select value={valor} onChange={(e) => onCambiar(e.target.value)}>
      {GRUPOS.map((g) => {
        const opciones = parametros.filter((p) => p.variable === g.variable);
        if (!opciones.length) return null;
        return (
          <optgroup key={g.variable} label={g.nombre}>
            {opciones.map((p) => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}
          </optgroup>
        );
      })}
    </select>
  );
}
