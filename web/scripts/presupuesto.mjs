// Presupuesto de la carga inicial del visor: lo que el navegador descarga antes
// de poder pintar la página (el script de entrada, lo que precarga y el CSS que
// bloquea), medido con gzip como lo sirve nginx. Si crece por encima del
// presupuesto, o si MapLibre o Recharts vuelven a entrar en esa carga, la
// integración continua falla. Fase 6 de docs/plan_mejora_interfaz.md.
//
// Uso, después de `npm run build`:  node scripts/presupuesto.mjs
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

// Medido el 2026-11-06: unos 57 kB de JavaScript y 7 kB de CSS. El margen deja
// crecer el visor sin que una dependencia grande entre sin que nadie lo note.
const PRESUPUESTO = { js: 90, css: 15 };

const html = readFileSync("dist/index.html", "utf8");
const enlaces = (patron) => [...html.matchAll(patron)].map((m) => m[1]);
const scripts = [...enlaces(/<script[^>]*\ssrc="([^"]+)"/g), ...enlaces(/<link rel="modulepreload"[^>]*\shref="([^"]+)"/g)];
const estilos = enlaces(/<link rel="stylesheet"[^>]*\shref="([^"]+)"/g);
const kilobytes = (ruta) => gzipSync(readFileSync(`dist${ruta}`)).length / 1024;
const suma = (rutas) => rutas.reduce((total, ruta) => total + kilobytes(ruta), 0);

const medido = { js: suma(scripts), css: suma(estilos) };
const fallas = [];
for (const tipo of ["js", "css"]) {
  const linea = `${tipo.toUpperCase()} inicial: ${medido[tipo].toFixed(1)} kB con gzip (presupuesto ${PRESUPUESTO[tipo]} kB)`;
  console.log(linea);
  if (medido[tipo] > PRESUPUESTO[tipo]) fallas.push(linea);
}
// El mapa y las gráficas se cargan en diferido: si alguno aparece en la carga
// inicial, algo los volvió a importar de forma estática.
for (const ruta of [...scripts, ...estilos].filter((r) => /\/assets\/(mapa|graficas)-/.test(r))) {
  fallas.push(`${ruta} entró en la carga inicial`);
}
if (fallas.length) {
  console.error(`\nPresupuesto superado:\n- ${fallas.join("\n- ")}`);
  process.exit(1);
}
console.log("Dentro del presupuesto.");
