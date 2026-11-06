import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cicloDiario, formatearNumero, horaTexto, marcasEje, MINIMO_HORAS_CICLO } from "../util.js";

// Ciclo del día (plan de funcionalidades, F4): a qué hora suele estar más alta
// la variable en la estación, con los datos horarios del periodo consultado.
// Ayuda a decidir, por ejemplo, a qué hora salir a hacer ejercicio.
export default function CicloDiario({ puntos, nombre, unidad, parametro, agregacion }) {
  // La dirección del viento es un ángulo: su promedio por hora no significa nada.
  if (parametro === "DV") return null;
  const titulo = <h4 id="titulo-ciclo">Ciclo del día</h4>;
  if (agregacion !== "hora") {
    return (
      <section className="ciclo" aria-labelledby="titulo-ciclo">
        {titulo}
        <p className="nota">Para ver a qué hora suele estar más alto, consulte un periodo de 93 días o menos.</p>
      </section>
    );
  }
  const conDato = puntos.filter((p) => p.valor != null).length;
  if (conDato < MINIMO_HORAS_CICLO) {
    return (
      <section className="ciclo" aria-labelledby="titulo-ciclo">
        {titulo}
        <p className="nota">Hacen falta al menos {MINIMO_HORAS_CICLO} horas con dato para calcularlo; este periodo tiene {conDato}.</p>
      </section>
    );
  }

  const ciclo = cicloDiario(puntos);
  const conPromedio = ciclo.filter((h) => h.promedio != null);
  const pico = conPromedio.reduce((a, b) => (b.promedio > a.promedio ? b : a));
  const valle = conPromedio.reduce((a, b) => (b.promedio < a.promedio ? b : a));
  const marcas = marcasEje(pico.promedio);
  const resumen = `En este periodo, los valores de ${nombre} suelen ser más altos hacia las ${horaTexto(pico.hora)} `
    + `(${formatearNumero(pico.promedio)} ${unidad} en promedio) y más bajos hacia las ${horaTexto(valle.hora)} `
    + `(${formatearNumero(valle.promedio)} ${unidad}).`;

  return (
    <section className="ciclo" aria-labelledby="titulo-ciclo">
      {titulo}
      <p className="resumen">{resumen}</p>
      <p className="unidad-eje">{nombre} en {unidad}, promedio de cada hora del día (hora de Colombia)</p>
      <div role="img" aria-label={resumen}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={ciclo} margin={{ top: 8, right: 16, bottom: 4, left: 0 }} barCategoryGap={2}>
            <CartesianGrid stroke="var(--rejilla)" vertical={false} />
            <XAxis dataKey="hora" tickFormatter={horaTexto} interval={2} tick={{ fontSize: 12, fill: "var(--eje-texto)" }}
                   axisLine={{ stroke: "var(--eje-linea)" }} tickLine={false} />
            <YAxis width={44} tick={{ fontSize: 12, fill: "var(--eje-texto)" }} tickFormatter={formatearNumero}
                   axisLine={false} tickLine={false} ticks={marcas} domain={[0, marcas.at(-1)]} />
            <Tooltip cursor={{ fill: "var(--rejilla)" }} contentStyle={{ borderRadius: 8, fontFamily: "inherit" }}
                     labelFormatter={(hora) => `${horaTexto(hora)} a ${horaTexto((hora + 1) % 24)}`}
                     formatter={(v, _n, { payload }) => [v == null ? "sin dato"
                       : `${formatearNumero(v)} ${unidad} (${payload.n} ${payload.n === 1 ? "hora" : "horas"})`, "Promedio"]} />
            <Bar dataKey="promedio" fill="var(--serie)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="tabla-ciclo">
        <summary>Ver el ciclo como tabla</summary>
        <div className="tabla-datos">
          <table>
            <thead><tr><th scope="col">Hora</th><th scope="col">Promedio ({unidad})</th><th scope="col">Horas con dato</th></tr></thead>
            <tbody>
              {ciclo.map((h) => (
                <tr key={h.hora}>
                  <td>{horaTexto(h.hora)}</td>
                  <td className="numero">{h.promedio == null ? "sin dato" : formatearNumero(h.promedio)}</td>
                  <td className="numero">{h.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
