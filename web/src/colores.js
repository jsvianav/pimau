// Colores que no pueden vivir solo en estilos.css: MapLibre pinta en un lienzo
// (no lee variables de CSS) y la escala del ICA necesita sus seis colores en
// orden. Antes estaban repetidos en Mapa.jsx y Ficha.jsx; aquí hay una sola copia
// y el mapa ya no se importa solo para leer un color.

// Color de estado "crítico" de la paleta validada: reservado para las alertas.
export const COLOR_ALERTA = "#d03b3b";

// Rangos del índice (0 a 500) de la Resolución 2254 de 2017. Los colores de
// cada categoría llegan de /api/umbrales; estos son el respaldo, en el mismo orden.
export const RANGOS_INDICE = [[0, 50], [51, 100], [101, 150], [151, 200], [201, 300], [301, 500]];
export const COLORES_ICA = ["#00E400", "#FFFF00", "#FF7E00", "#FF0000", "#8F3F97", "#7E0023"];

// Valor de un token de estilos.css en el modo (claro u oscuro) activo.
export function leerToken(nombre, respaldo) {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || respaldo;
}

// Colores del mapa en cada modo. Los del ICA no cambian; cambian el mapa base,
// los rótulos y los límites del territorio, para que sigan a la vista en oscuro.
// El mapa base se suaviza para que quede en segundo plano y los colores del ICA
// sean lo único que resalte: menos rótulos, calles más claras y agua y parques
// en tonos apagados.
export const TEMAS_MAPA = {
  claro: {
    estilo: "https://tiles.openfreemap.org/styles/positron",
    base: {
      background: { "background-color": "#f3f5f4" },
      park: { "fill-color": "#e2ece4" },
      landcover_wood: { "fill-color": "#dfe9e0" },
      landuse_residential: { "fill-color": "#eef1ef" },
      water: { "fill-color": "#d4e1e6" },
      waterway: { "line-color": "#d4e1e6" },
      building: { "fill-color": "#e9ecea" },
    },
    ocultar: [/^highway-shield/, /^road_shield/, /^highway-name-(path|minor)$/, /^railway/, /^aeroway/, /^airport$/,
              /^label_(country|state)/,
              // Toda la plataforma es sobre Cali: el rótulo de la ciudad solo tapa estaciones.
              /^label_city/],
    rotulos: /^label_/,
    rotuloBase: "#66736f",
    texto: "#1b2b28", textoSinDatos: "#5f6d69", halo: "rgba(255,255,255,0.92)",
    contorno: "#ffffff", seleccion: "#1b2b28", hueco: "#ffffff", sinIca: "#7d8790", anomalia: "#1b2b28",
    capas: { comuna: "#2f4a45", corregimiento: "#5b7f63", barrio: "#8a9a95" },
    // Opacidad del relleno de las zonas: [comuna, corregimiento].
    zonas: [0.22, 0.1],
  },
  oscuro: {
    estilo: "https://tiles.openfreemap.org/styles/dark",
    base: {
      background: { "background-color": "#121a18" },
      landuse_park: { "fill-color": "#15221e" },
      landcover_wood: { "fill-color": "#15221e" },
      landuse_residential: { "fill-color": "#141d1b" },
      water: { "fill-color": "#172629" },
      waterway: { "line-color": "#172629" },
      building: { "fill-color": "#18211f" },
    },
    ocultar: [/^road_oneway/, /^railway/, /^aeroway/, /^highway_name_motorway$/, /^place_(country|state)/,
              /^place_city/],
    rotulos: /^place_/,
    rotuloBase: "#8d9a96",
    texto: "#e5ecea", textoSinDatos: "#96a39f", halo: "rgba(18,26,24,0.92)",
    contorno: "#121a18", seleccion: "#e5ecea", hueco: "#1b2522", sinIca: "#7f8a93", anomalia: "#e5ecea",
    capas: { comuna: "#9fb8b1", corregimiento: "#8fb597", barrio: "#6f807b" },
    // Sobre fondo oscuro un relleno más tenue: más opaco, el amarillo del ICA se ve verde oliva.
    zonas: [0.12, 0.06],
  },
};
