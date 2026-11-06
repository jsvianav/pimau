// Utilidades del visor sin dependencias del navegador, para poder probarlas.

export const ZONA = "America/Bogota";
// Nombres cortos para etiquetas. El nombre completo y la unidad vienen de la API.
export const PARAMETROS = {
  PM25: "PM2.5", PM10: "PM10", O3: "O₃", NO2: "NO₂", SO2: "SO₂", CO: "CO", H2S: "H₂S",
  TEMP: "Temperatura", HUM: "Humedad", VV: "Viento", DV: "Dirección del viento",
  LLUVIA: "Lluvia", RAD: "Radiación solar", PRES: "Presión", RUIDO: "Ruido",
};

export function nombreCorto(codigo) {
  return PARAMETROS[codigo] || codigo;
}

// Marcas redondas para el eje Y de una gráfica que empieza en cero (0, 50, 100…),
// con unas cinco divisiones y la última igual o por encima del máximo.
export function marcasEje(maximo, divisiones = 5) {
  if (!(maximo > 0)) return [0, 1];
  const bruto = maximo / divisiones;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((f) => f * potencia).find((p) => p >= bruto);
  const pasos = Math.ceil(maximo / paso - 1e-9);
  return Array.from({ length: pasos + 1 }, (_, i) => Number((i * paso).toFixed(10)));
}

export function textoVentana(horas) {
  return horas === 1 ? "valor de 1 hora" : `promedio de ${horas} horas`;
}
export const HORAS_MINIMAS_ICA = 18;

// Clave para reconocer la misma estación en fuentes distintas: "ERA - Obrero"
// y "Era Obrero", o "Transitoria EDB Navarro" y "Transitoria-Navarro".
const PALABRAS_IGNORADAS = new Set(["edb", "estacion", "de", "del", "la"]);

export function claveEstacion(nombre) {
  return nombre
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ")
    .split(" ").filter((p) => p && !PALABRAS_IGNORADAS.has(p))
    .join(" ");
}

// Las coordenadas de la IDESC (usadas por el portal de Cali) son las oficiales.
// El IDEAM publica algunas estaciones con coordenadas que no corresponden
// (ver docs/bitacora.md), así que se usan solo si no hay otra fuente.
const FUENTE_COORDENADAS = "Datos Abiertos de Cali";

// Una misma estación puede venir de dos fuentes con códigos distintos. En el
// mapa se agrupan y la ficha muestra cada fuente por separado.
export function agruparEstaciones(geojson) {
  const grupos = new Map();
  for (const f of geojson.features) {
    const clave = claveEstacion(f.properties.nombre);
    const grupo = grupos.get(clave) || { registros: [], coordenadas: null, preferidas: false };
    grupo.registros.push(f.properties);
    const esOficial = f.properties.fuente.startsWith(FUENTE_COORDENADAS);
    if (!grupo.coordenadas || (esOficial && !grupo.preferidas)) {
      grupo.coordenadas = f.geometry.coordinates;
      grupo.preferidas = esOficial;
    }
    grupos.set(clave, grupo);
  }
  // El id sale del nombre normalizado ("universidad-libre"): no cambia cuando
  // llega una estación nueva, como pasaba con la posición en la lista, y sirve
  // para el enlace de cada estación (?estacion=universidad-libre).
  return [...grupos.entries()]
    .map(([clave, g]) => ({ id: clave.replace(/ /g, "-"), coordenadas: g.coordenadas, nombre: nombreDelGrupo(g.registros),
                            registros: g.registros }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

function nombreDelGrupo(registros) {
  // Se prefiere el nombre más largo, que suele ser el más descriptivo.
  return registros.map((r) => r.nombre).sort((a, b) => b.length - a.length)[0];
}

// Un dato es reciente si se midió en las últimas 48 horas. Solo SATIC publica
// datos así de recientes; el resto de las fuentes termina en 2024 o antes.
export const HORAS_RECIENTE = 48;

export function esReciente(iso, ahora = new Date()) {
  return Boolean(iso) && ahora - new Date(iso) <= HORAS_RECIENTE * 3600000;
}

// Fecha del último dato válido de un grupo, entre todas sus fuentes y variables.
export function ultimoDatoDelGrupo(grupo) {
  const fechas = grupo.registros.flatMap((r) => Object.values(r.parametros).map((p) => p.instante)).filter(Boolean);
  return fechas.length ? fechas.sort().at(-1) : null;
}

// Estado que representa al grupo en el mapa para un parámetro: el ICA más
// reciente entre sus fuentes. Si ninguna fuente tiene ICA, el dato más reciente.
// Con soloRecientes, se ignoran los datos de más de 48 horas.
export function estadoMasReciente(grupo, parametro, { soloRecientes = false, ahora = new Date() } = {}) {
  const estados = grupo.registros
    // Una variable puede venir sin valor válido, solo con mediciones marcadas.
    .filter((r) => r.parametros[parametro]?.instante)
    .filter((r) => !soloRecientes || esReciente(r.parametros[parametro].instante, ahora))
    .map((r) => ({ registro: r, estado: r.parametros[parametro] }));
  if (!estados.length) return null;
  const conIca = estados.filter((e) => e.estado.categoria);
  if (conIca.length) return conIca.sort((a, b) => b.estado.instante_ica.localeCompare(a.estado.instante_ica))[0];
  return estados.sort((a, b) => b.estado.instante.localeCompare(a.estado.instante))[0];
}

export function formatearFecha(iso, conHora = true) {
  const opciones = { timeZone: ZONA, day: "2-digit", month: "short", year: "numeric" };
  if (conHora) Object.assign(opciones, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return new Intl.DateTimeFormat("es-CO", opciones).format(new Date(iso));
}

export function antiguedad(iso, ahora = new Date()) {
  const horas = Math.floor((ahora - new Date(iso)) / 3600000);
  if (horas < 1) return "hace menos de una hora";
  if (horas < 24) return horas === 1 ? "hace 1 hora" : `hace ${horas} horas`;
  const dias = Math.floor(horas / 24);
  if (dias < 2) return "hace 1 día";
  if (dias < 60) return `hace ${dias} días`;
  const meses = Math.floor(dias / 30.44);
  if (meses < 24) return `hace ${meses} meses`;
  return `hace ${Math.floor(meses / 12)} años`;
}

// Versión corta para la lista de estaciones: "hace 2 h", "hace 3 d".
export function antiguedadCorta(iso, ahora = new Date()) {
  const horas = Math.floor((ahora - new Date(iso)) / 3600000);
  if (horas < 1) return "hace < 1 h";
  if (horas < 48) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

// Fecha y hora de un dato en pocas palabras: "hoy, 04:00" si es del mismo día.
export function fechaCorta(iso, ahora = new Date()) {
  const hora = new Intl.DateTimeFormat("es-CO", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(iso));
  if (fechaISO(new Date(iso)) === fechaISO(ahora)) return `hoy, ${hora}`;
  if (fechaISO(new Date(iso)) === restarDias(fechaISO(ahora), 1)) return `ayer, ${hora}`;
  return formatearFecha(iso);
}

// Ruido (Resolución 627 de 2006): el horario diurno va de las 7:01 a las 21:00.
// Las mediciones horarias se fechan al final de su hora, así que la que termina
// entre las 8:00 y las 21:00 es de día.
export function periodoRuido(iso) {
  const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", hourCycle: "h23" })
    .format(new Date(iso)));
  return hora >= 8 && hora <= 21 ? "Día" : "Noche";
}

// Color de texto legible (contraste mínimo 4,5:1) sobre el color de la categoría.
export function textoSobre(colorHex) {
  if (!colorHex) return "#1a1a1a";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colorHex.slice(i, i + 2), 16) / 255);
  const lineal = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminancia = 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
  return luminancia > 0.179 ? "#1a1a1a" : "#ffffff";
}

const NUMERO = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });

export function formatearNumero(valor) {
  return valor == null ? "—" : NUMERO.format(valor);
}

export function fechaISO(fecha) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(fecha);
}

export function restarDias(isoDia, dias) {
  const d = new Date(`${isoDia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

// --- Zonas con estación ------------------------------------------------------
// Método del rayo: un punto está dentro de un anillo si una semirrecta desde él
// cruza el borde un número impar de veces.
function dentroDeAnillo([x, y], anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function dentroDePoligono(punto, [exterior, ...huecos]) {
  return dentroDeAnillo(punto, exterior) && !huecos.some((h) => dentroDeAnillo(punto, h));
}

export function puntoEnGeometria(punto, geometria) {
  if (geometria?.type === "Polygon") return dentroDePoligono(punto, geometria.coordinates);
  if (geometria?.type === "MultiPolygon") return geometria.coordinates.some((p) => dentroDePoligono(punto, p));
  return false;
}

// Nombre legible de la comuna o del corregimiento que contiene un punto.
export function zonaDe(capas, punto) {
  for (const tipo of ["comuna", "corregimiento"]) {
    const zona = (capas[tipo]?.features || []).find((f) => puntoEnGeometria(punto, f.geometry));
    if (zona) {
      return tipo === "comuna"
        ? `Comuna ${Number(zona.properties.codigo)}`
        : `Corregimiento ${zona.properties.nombre}`;
    }
  }
  return null;
}

// Devuelve las comunas (o, para las estaciones rurales, los corregimientos) que
// contienen una estación, coloreadas con su categoría del ICA. Si una zona tiene
// varias estaciones, se usa la peor categoría. Las variables sin ICA no colorean.
export function zonasConEstacion(capas, grupos, parametro, opciones) {
  const zonas = new Map();
  for (const g of grupos) {
    const estado = estadoMasReciente(g, parametro, opciones)?.estado;
    if (!estado?.categoria || estado.ica == null) continue;
    const zona = [capas.comuna, capas.corregimiento]
      .flatMap((c) => c?.features || [])
      .find((f) => puntoEnGeometria(g.coordenadas, f.geometry));
    if (!zona) continue;
    const clave = `${zona.properties.tipo}-${zona.properties.codigo}`;
    const previa = zonas.get(clave);
    if (!previa || estado.ica > previa.properties.ica) {
      zonas.set(clave, { type: "Feature", geometry: zona.geometry,
                         properties: { nombre: zona.properties.nombre, tipo: zona.properties.tipo, color: estado.color, ica: estado.ica } });
    }
  }
  return { type: "FeatureCollection", features: [...zonas.values()] };
}

// Ciclo del día: promedio de cada hora local (0 a 23) en el periodo consultado.
// Colombia no tiene horario de verano, así que la hora local es la UTC menos 5.
// Solo tiene sentido con datos horarios; la dirección del viento no se promedia
// así (350° y 10° no dan 180°), y la serie necesita al menos dos días con dato.
export const MINIMO_HORAS_CICLO = 48;

export function cicloDiario(puntos) {
  const horas = Array.from({ length: 24 }, (_, hora) => ({ hora, suma: 0, n: 0 }));
  for (const p of puntos) {
    if (p.valor == null) continue;
    const hora = (new Date(p.t).getUTCHours() + 19) % 24;
    horas[hora].suma += p.valor;
    horas[hora].n += 1;
  }
  return horas.map(({ hora, suma, n }) => ({ hora, promedio: n ? suma / n : null, n }));
}

export function horaTexto(hora) {
  return `${String(hora).padStart(2, "0")}:00`;
}
