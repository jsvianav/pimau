// Estado del visor en la dirección de la página: un enlace abre la misma vista
// (pestaña, estación, variable, periodo del Histórico) y «Atrás» vuelve a la
// anterior. Son parámetros sobre "/", así que nginx no necesita cambios.
//
// Los valores que llegan en la URL solo eligen entre opciones conocidas: lo que
// no tiene la forma esperada se ignora y nunca se inserta como HTML.

export const VISTAS = ["mapa", "historico", "admin"];
export const VARIABLE_INICIAL = "PM25";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const CODIGO = /^[A-Z0-9]{1,12}$/;
const ESTACION = /^[a-z0-9-]{1,80}$/;

function valor(parametros, nombre, forma) {
  const texto = parametros.get(nombre);
  return texto && forma.test(texto) ? texto : null;
}

export function leerUrl(busqueda) {
  const p = new URLSearchParams(busqueda);
  const vista = VISTAS.includes(p.get("vista")) ? p.get("vista") : "mapa";
  const variable = valor(p, "variable", CODIGO);
  if (vista === "mapa") {
    return { vista, variable, estacion: valor(p, "estacion", ESTACION), soloRecientes: p.get("vigencia") !== "todo" };
  }
  if (vista === "historico") {
    const serie = Number(p.get("serie"));
    return { vista, variable, serie: Number.isInteger(serie) && serie > 0 ? serie : null,
             desde: valor(p, "desde", FECHA), hasta: valor(p, "hasta", FECHA) };
  }
  return { vista };
}

// Lo que coincide con el valor inicial no se escribe, para que los enlaces sean cortos.
export function escribirUrl(estado) {
  const p = new URLSearchParams();
  if (estado.vista !== "mapa") p.set("vista", estado.vista);
  if (estado.vista === "mapa") {
    if (estado.estacion) p.set("estacion", estado.estacion);
    if (estado.variable && estado.variable !== VARIABLE_INICIAL) p.set("variable", estado.variable);
    if (estado.soloRecientes === false) p.set("vigencia", "todo");
  }
  if (estado.vista === "historico") {
    if (estado.serie) p.set("serie", String(estado.serie));
    if (estado.variable) p.set("variable", estado.variable);
    if (estado.desde) p.set("desde", estado.desde);
    if (estado.hasta) p.set("hasta", estado.hasta);
  }
  const texto = p.toString();
  return texto ? `?${texto}` : "";
}

// Cambiar de pestaña o de estación es un paso que «Atrás» debe deshacer; cambiar
// la variable, la vigencia o el periodo solo actualiza la dirección.
export function esNuevoPaso(antes, despues) {
  if (!antes) return false;
  return antes.vista !== despues.vista || (despues.vista === "mapa" && antes.estacion !== despues.estacion);
}
