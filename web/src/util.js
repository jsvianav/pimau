// Utilidades del visor sin dependencias del navegador, para poder probarlas.

export const ZONA = "America/Bogota";
// Nombres cortos para etiquetas. El nombre completo y la unidad vienen de la API.
export const PARAMETROS = {
  PM25: "PM2.5", PM10: "PM10", O3: "O₃", NO2: "NO₂", SO2: "SO₂", CO: "CO", H2S: "H₂S",
  TEMP: "Temperatura", HUM: "Humedad", VV: "Viento", DV: "Dirección del viento",
  LLUVIA: "Lluvia", RAD: "Radiación solar", PRES: "Presión",
};

export function nombreCorto(codigo) {
  return PARAMETROS[codigo] || codigo;
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
  return [...grupos.values()]
    .map((g) => ({ coordenadas: g.coordenadas, nombre: nombreDelGrupo(g.registros), registros: g.registros }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    .map((g, i) => ({ id: i, ...g }));
}

function nombreDelGrupo(registros) {
  // Se prefiere el nombre más largo, que suele ser el más descriptivo.
  return registros.map((r) => r.nombre).sort((a, b) => b.length - a.length)[0];
}

// Estado que representa al grupo en el mapa para un parámetro: el ICA más
// reciente entre sus fuentes. Si ninguna fuente tiene ICA, el dato más reciente.
export function estadoMasReciente(grupo, parametro) {
  const estados = grupo.registros
    .filter((r) => r.parametros[parametro])
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
  const dias = Math.floor((ahora - new Date(iso)) / 86400000);
  if (dias < 1) return "hoy";
  if (dias < 60) return `hace ${dias} días`;
  const meses = Math.floor(dias / 30.44);
  if (meses < 24) return `hace ${meses} meses`;
  return `hace ${Math.floor(meses / 12)} años`;
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

// Devuelve las comunas (o, para las estaciones rurales, los corregimientos) que
// contienen una estación, coloreadas con su categoría del ICA. Si una zona tiene
// varias estaciones, se usa la peor categoría. Las variables sin ICA no colorean.
export function zonasConEstacion(capas, grupos, parametro) {
  const zonas = new Map();
  for (const g of grupos) {
    const estado = estadoMasReciente(g, parametro)?.estado;
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
