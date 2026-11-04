// API simulada para las pruebas de extremo a extremo. Intercepta /api/* con
// datos inventados que siguen backend/pimau/api/esquemas.py, y el mapa base de
// OpenFreeMap con un estilo mínimo, así que las pruebas no necesitan el backend
// ni salida a internet.
//
// Casos (como ?datos= en desarrollo, ver src/desarrollo/casos.js):
//   normal  estaciones de las tres fuentes, una alerta, una anomalía y un sensor detenido
//   peor    nombres largos, doce alertas y una estación en el tope del ICA (500)
//   vacio   ninguna estación
//   error   la API responde 503

const COLORES = ["#00E400", "#FFFF00", "#FF7E00", "#FF0000", "#8F3F97", "#7E0023"];
const CATEGORIAS = ["Buena", "Aceptable", "Dañina a la salud de grupos sensibles", "Dañina a la salud",
  "Muy dañina a la salud", "Peligrosa"];
const CORTES = {
  PM25: [[0, 12], [13, 37], [38, 55], [56, 150], [151, 250], [251, 500]],
  PM10: [[0, 54], [55, 154], [155, 254], [255, 354], [355, 424], [425, 604]],
};
const RANGOS_INDICE = [[0, 50], [51, 100], [101, 150], [151, 200], [201, 300], [301, 500]];

export const SATIC = "SATIC (red OAC22)";
export const IDEAM = "IDEAM (datos.gov.co)";
export const CALI = "Datos Abiertos de Cali";

const horasAtras = (horas) => new Date(Date.now() - horas * 3600000).toISOString();

// ICA por interpolación entre puntos de corte, con la concentración truncada
// al entero (la misma regla de backend/pimau/api/ica.py).
function ica(parametro, concentracion) {
  const cortes = CORTES[parametro];
  const valor = Math.trunc(concentracion);
  const i = cortes.findIndex(([, alto]) => valor <= alto);
  const k = i === -1 ? 5 : i;
  const [bajo, alto] = cortes[k];
  const [indiceBajo, indiceAlto] = RANGOS_INDICE[k];
  const indice = Math.round(((indiceAlto - indiceBajo) / (alto - bajo)) * (Math.min(valor, alto) - bajo) + indiceBajo);
  return { ica: indice, categoria: CATEGORIAS[k], color: COLORES[k] };
}

function aire(parametro, valor, horas, extra = {}) {
  return {
    instante: horasAtras(horas), valor_horario: valor, ventana_ica_horas: 24, instante_ica: horasAtras(horas),
    promedio_ica: valor, horas_validas_ica: 22, ...ica(parametro, valor),
    guia_oms: { periodo: "24 horas", valor: parametro === "PM25" ? 15 : 45, comparable: true },
    anomalias_48h: 0, ultima_anomala: false, ultima_marcada: null, ...extra,
  };
}

function sinIca(valor, horas) {
  return {
    instante: horasAtras(horas), valor_horario: valor, ventana_ica_horas: null, instante_ica: null,
    promedio_ica: null, horas_validas_ica: null, ica: null, categoria: null, color: null, guia_oms: null,
    anomalias_48h: 0, ultima_anomala: false, ultima_marcada: null,
  };
}

// Sensor detenido: ningún dato válido y el último marcado como sospechoso.
function detenido(parametro) {
  return { ...sinIca(null, 0), instante: null, ventana_ica_horas: parametro === "PM25" ? 24 : null,
           ultima_marcada: { instante: horasAtras(1), bandera: "sospechoso" } };
}

const HACE_IDEAM = 24 * 680;   // el IDEAM llega hasta el 1 de enero de 2025
const HACE_CALI = 24 * 2290;   // el portal de Cali, hasta 2020

function estacion(id, nombre, fuente, coordenadas, parametros) {
  return { type: "Feature", geometry: { type: "Point", coordinates: coordenadas },
           properties: { id, nombre, codigo: `E${id}`, fuente, parametros } };
}

function estacionesNormales() {
  return [
    estacion(1, "Base Aérea", CALI, [-76.4997, 3.4553],
      { PM10: aire("PM10", 41, HACE_CALI), PM25: aire("PM25", 18, HACE_CALI) }),
    estacion(2, "Base Aérea", IDEAM, [-76.501, 3.456],
      { PM10: aire("PM10", 47, HACE_IDEAM), PM25: aire("PM25", 21, HACE_IDEAM) }),
    estacion(3, "ERA - Obrero", CALI, [-76.5247, 3.4497], { PM10: aire("PM10", 60, HACE_CALI) }),
    estacion(4, "Cañaveralejo", CALI, [-76.548, 3.4185],
      { PM10: aire("PM10", 38, HACE_CALI), PM25: aire("PM25", 14, HACE_CALI) }),
    estacion(5, "Universidad del Valle", IDEAM, [-76.5333, 3.376],
      { PM25: aire("PM25", 11, HACE_IDEAM), TEMP: sinIca(24.1, HACE_IDEAM) }),
    estacion(6, "Pance", IDEAM, [-76.556, 3.333], { PM25: aire("PM25", 7, HACE_IDEAM) }),
    estacion(7, "Universidad de San Buenaventura", SATIC, [-76.544, 3.345], {
      PM25: aire("PM25", 9.4, 1.5, { anomalias_48h: 2 }), PM10: aire("PM10", 10.2, 1.5),
      TEMP: sinIca(26.4, 1.5), HUM: sinIca(71, 1.5), RUIDO: sinIca(58.2, 1.5),
    }),
    estacion(8, "Universidad Javeriana", SATIC, [-76.531, 3.349], { PM25: detenido("PM25") }),
    estacion(9, "Universidad Libre", SATIC, [-76.519, 3.356],
      { PM25: aire("PM25", 41.3, 2), PM10: aire("PM10", 44, 2) }),
    estacion(10, "San Martín", SATIC, [-76.526, 3.369], {
      PM25: aire("PM25", 64.8, 1, { ultima_anomala: true, anomalias_48h: 5 }), PM10: aire("PM10", 70, 1),
    }),
    estacion(11, "Bagatelle", SATIC, [-76.537, 3.362], { PM25: aire("PM25", 22.6, 3), TEMP: sinIca(25.2, 3) }),
    estacion(12, "Valle del Lili", SATIC, [-76.516, 3.372], { PM25: aire("PM25", 12.2, 2), RUIDO: sinIca(66.1, 2) }),
    estacion(13, "Holguines", SATIC, [-76.54, 3.376], { PM25: aire("PM25", 30.1, 1) }),
  ];
}

// Peor caso: nombres largos, una fuente de nombre largo y una estación en el tope del ICA.
const NOMBRES_LARGOS = [
  "Institución Educativa Técnico Industrial Antonio José Camacho - Sede Principal",
  "Colegio Nuestra Señora de los Andes y del Perpetuo Socorro",
];
export const FUENTE_LARGA = "Sistema de Alertas Tempranas Ambientales de Cali - SATIC (red OAC22, sensores de bajo costo)";

function estacionesPeores() {
  const lista = estacionesNormales();
  const tope = lista.find((f) => f.properties.id === 7).properties;
  tope.nombre = NOMBRES_LARGOS[0];
  tope.fuente = FUENTE_LARGA;
  tope.parametros.PM25 = aire("PM25", 500, 1, { valor_horario: 1234.5, anomalias_48h: 1, ultima_anomala: true,
    ultima_marcada: { instante: horasAtras(0.5), bandera: "sospechoso" } });
  lista.find((f) => f.properties.id === 9).properties.nombre = NOMBRES_LARGOS[1];
  return lista;
}

const PARAMETROS = [
  { codigo: "PM25", nombre: "Material particulado PM2.5", unidad: "µg/m³", variable: "calidad_aire", con_datos: true, ventana_ica_horas: 24 },
  { codigo: "PM10", nombre: "Material particulado PM10", unidad: "µg/m³", variable: "calidad_aire", con_datos: true, ventana_ica_horas: 24 },
  { codigo: "TEMP", nombre: "Temperatura del aire", unidad: "°C", variable: "meteorologia", con_datos: true, ventana_ica_horas: null },
  { codigo: "HUM", nombre: "Humedad relativa", unidad: "%", variable: "meteorologia", con_datos: true, ventana_ica_horas: null },
  { codigo: "RUIDO", nombre: "Ruido ambiental", unidad: "dB(A)", variable: "ruido", con_datos: true, ventana_ica_horas: null },
];

const UMBRALES = {
  PM25: { ica: CORTES.PM25.map(([inferior, superior], i) => ({ categoria: CATEGORIAS[i], inferior, superior, color: COLORES[i] })),
          oms: { "24 horas": 15, Anual: 5 }, ruido: {} },
  PM10: { ica: CORTES.PM10.map(([inferior, superior], i) => ({ categoria: CATEGORIAS[i], inferior, superior, color: COLORES[i] })),
          oms: { "24 horas": 45, Anual: 15 }, ruido: {} },
  TEMP: { ica: [], oms: {}, ruido: {} },
  HUM: { ica: [], oms: {}, ruido: {} },
  RUIDO: { ica: [], oms: {}, ruido: { Día: 65, Noche: 50 } },
};

function alertas(caso, estaciones) {
  if (caso === "peor") {
    // Doce alertas: la lista empuja la ficha hacia abajo en el panel.
    return estaciones.slice(0, 12).map((f, i) => ({
      estacion_id: f.properties.id, estacion: f.properties.nombre, parametro: "PM25",
      valor: 1234.5 - i, umbral: 37, unidad: "µg/m³", instante: horasAtras(i + 1),
    }));
  }
  return [{ estacion_id: 10, estacion: "San Martín", parametro: "PM25", valor: 64.8, umbral: 55, unidad: "µg/m³",
            instante: horasAtras(1) }];
}

// Comunas: una rejilla de 22 rectángulos sobre el casco urbano; corregimientos al sur.
function rectangulo(x0, y0, x1, y1) { return [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]; }
function capa(tipo) {
  const features = [];
  if (tipo === "comuna") {
    const xs = [-76.565, -76.545, -76.525, -76.505, -76.485, -76.465];
    const ys = [3.355, 3.385, 3.415, 3.445, 3.475, 3.5];
    let n = 0;
    for (let fila = 0; fila < 5; fila++) {
      for (let columna = 0; columna < 5 && n < 22; columna++) {
        n++;
        features.push({ type: "Feature",
          geometry: { type: "Polygon", coordinates: rectangulo(xs[columna], ys[fila], xs[columna + 1], ys[fila + 1]) },
          properties: { codigo: String(n).padStart(2, "0"), nombre: `Comuna ${n}`, tipo } });
      }
    }
  } else if (tipo === "corregimiento") {
    features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: rectangulo(-76.62, 3.3, -76.545, 3.355) },
                    properties: { codigo: "53", nombre: "Pance", tipo } });
    features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: rectangulo(-76.545, 3.3, -76.46, 3.355) },
                    properties: { codigo: "52", nombre: "El Hormiguero", tipo } });
  }
  return { type: "FeatureCollection", features };
}

function rango(estaciones, id) {
  const fuente = estaciones.find((f) => f.properties.id === id)?.properties.fuente;
  if (fuente === IDEAM) return { desde: "2020-01-01", hasta: "2025-01-01" };
  if (fuente === CALI) return { desde: "2010-01-28", hasta: "2020-08-01" };
  return { desde: "2026-09-20", hasta: new Date().toISOString().slice(0, 10) };
}

// Serie horaria con ciclo diario, huecos y un pico anómalo cada 211 horas; o
// promedios diarios con huecos.
function serie(estaciones, id, consulta) {
  const f = estaciones.find((e) => e.properties.id === id);
  const base = f?.properties.parametros[consulta.parametro]?.valor_horario ?? 20;
  const desde = Date.parse(`${consulta.desde}T00:00:00Z`);
  const hasta = Math.min(Date.parse(`${consulta.hasta}T23:00:00Z`), Date.now());
  const datos = [];
  if (consulta.agregacion === "dia") {
    for (let t = desde, i = 0; t <= hasta; t += 86400000, i++) {
      const hueco = i % 17 < 2;
      datos.push({ dia: new Date(t).toISOString().slice(0, 10), valor: hueco ? null : Math.round(base * (0.7 + 0.6 * Math.abs(Math.sin(i / 9))) * 10) / 10,
                   horas_validas: hueco ? 0 : 22, bandera: hueco ? "faltante" : "valido" });
    }
  } else {
    for (let t = desde, i = 0; t <= hasta; t += 3600000, i++) {
      const hora = new Date(t).getUTCHours();
      const hueco = i % 97 > 90;
      const pico = i % 211 === 50;
      const valor = hueco ? null
        : Math.round(Math.max(0, base * (0.75 + 0.45 * Math.sin(((hora - 9) / 24) * 2 * Math.PI)) + (pico ? base * 3 : 0)) * 10) / 10;
      datos.push({ instante: new Date(t).toISOString(), valor, bandera: hueco ? "faltante" : "valido",
                   anomalia: pico, puntaje_anomalia: pico ? 0.71 : null });
    }
  }
  return { estacion: { id, nombre: f?.properties.nombre ?? "?", fuente: f?.properties.fuente ?? "?" },
           parametro: consulta.parametro, agregacion: consulta.agregacion, datos };
}

function datosAdmin(caso) {
  const fuentes = [
    { id: 1, nombre: caso === "peor" ? FUENTE_LARGA : IDEAM, tipo_api: "Socrata", activa: true, frecuencia_min: 1440,
      con_conector: true, ultima_ejecucion: { inicio: horasAtras(5), fin: horasAtras(4.9), estado: "correcta", registros: 0, mensaje: null } },
    { id: 2, nombre: CALI, tipo_api: "CKAN", activa: true, frecuencia_min: 1440, con_conector: true,
      ultima_ejecucion: { inicio: horasAtras(6), fin: horasAtras(5.9), estado: "con_error", registros: null,
                          mensaje: "HTTP 403: suspensión temporal de servicios web" } },
    { id: 3, nombre: SATIC, tipo_api: "Archivos exportados", activa: true, frecuencia_min: 60, con_conector: true,
      ultima_ejecucion: { inicio: horasAtras(0.5), fin: horasAtras(0.45), estado: "correcta", registros: 112,
                          mensaje: "Advertencia: la descarga no tiene éxito desde hace 4 horas" } },
    { id: 4, nombre: "OpenAQ", tipo_api: "REST", activa: false, frecuencia_min: 60, con_conector: false, ultima_ejecucion: null },
  ];
  return {
    fuentes,
    ejecuciones: [{ fuente: CALI, inicio: horasAtras(6), fin: horasAtras(5.9), estado: "con_error", registros: null,
                    mensaje: "HTTP 403: suspensión temporal de servicios web" }],
    auditoria: [
      { instante: horasAtras(0.2), administrador: "admin@ejemplo.org", accion: "iniciar_sesion", resultado: "correcto", ip: "203.0.113.7" },
      { instante: horasAtras(3), administrador: null, accion: "acceso_sin_token /api/admin/fuentes", resultado: "rechazado",
        ip: "2001:0db8:85a3:0000:0000:8a2e:0370:7334" },
    ],
    umbrales: [
      { codigo: "PM25", nombre: "Material particulado PM2.5", unidad: "µg/m³", valor: 55, activo: true, actualizado: horasAtras(48) },
      { codigo: "PM10", nombre: "Material particulado PM10", unidad: "µg/m³", valor: null, activo: true, actualizado: null },
    ],
  };
}

export const SESION = { token: "token-de-prueba", correo: "admin@ejemplo.org" };

// Instala la API simulada en la página. Con `sesion: true` el administrador ya
// inició sesión (la sesión vive en sessionStorage, como en el visor).
export async function instalarApi(page, { caso = "normal", sesion = false } = {}) {
  const estaciones = caso === "vacio" ? [] : caso === "peor" ? estacionesPeores() : estacionesNormales();
  const admin = datosAdmin(caso);

  if (sesion) {
    await page.addInitScript((datos) => sessionStorage.setItem("pimau.sesion-admin", JSON.stringify(
      { ...datos, expira: new Date(Date.now() + 1800000).toISOString() })), SESION);
  }

  await page.route("https://tiles.openfreemap.org/**", (route) => {
    const url = route.request().url();
    if (url.includes("/styles/")) {
      return route.fulfill({ json: { version: 8, sources: {},
        // Sin «glyphs», MapLibre no acepta las capas con texto (nombres y comunas).
        glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
        layers: [{ id: "background", type: "background",
                   paint: { "background-color": url.includes("dark") ? "#121a18" : "#f3f5f4" } }] } });
    }
    return route.fulfill({ status: 200, contentType: "application/x-protobuf", body: "" });
  });

  await page.route(/\/api\//, (route) => {
    const peticion = route.request();
    const url = new URL(peticion.url());
    const ruta = url.pathname;
    const consulta = Object.fromEntries(url.searchParams);
    const metodo = peticion.method();
    let m;
    if (caso === "error" && !ruta.startsWith("/api/capas")) {
      return route.fulfill({ status: 503, json: { detail: "La base de datos no respondió a tiempo (tiempo de espera de 30 s agotado)" } });
    }
    if (ruta === "/api/estaciones") return route.fulfill({ json: { type: "FeatureCollection", features: estaciones } });
    if (ruta === "/api/umbrales") return route.fulfill({ json: UMBRALES });
    if (ruta === "/api/parametros") return route.fulfill({ json: PARAMETROS });
    if (ruta === "/api/alertas") return route.fulfill({ json: caso === "vacio" ? [] : alertas(caso, estaciones) });
    if ((m = ruta.match(/^\/api\/capas\/(\w+)$/))) return route.fulfill({ json: capa(m[1]) });
    if ((m = ruta.match(/^\/api\/estaciones\/(\d+)\/rango$/))) return route.fulfill({ json: rango(estaciones, Number(m[1])) });
    if ((m = ruta.match(/^\/api\/estaciones\/(\d+)\/series$/))) {
      return route.fulfill({ json: serie(estaciones, Number(m[1]), consulta) });
    }
    if (ruta === "/api/admin/sesion" && metodo === "POST") {
      return route.fulfill({ json: { ...SESION, expira: new Date(Date.now() + 1800000).toISOString() } });
    }
    if ((m = ruta.match(/^\/api\/admin\/fuentes\/(\d+)$/)) && metodo === "PATCH") {
      const fuente = admin.fuentes.find((f) => f.id === Number(m[1]));
      Object.assign(fuente, peticion.postDataJSON());
      return route.fulfill({ json: fuente });
    }
    if ((m = ruta.match(/^\/api\/admin\/umbrales\/(\w+)$/)) && metodo === "PUT") {
      const umbral = admin.umbrales.find((u) => u.codigo === m[1]);
      Object.assign(umbral, peticion.postDataJSON(), { actualizado: new Date().toISOString() });
      return route.fulfill({ json: umbral });
    }
    if ((m = ruta.match(/^\/api\/admin\/(fuentes|ejecuciones|auditoria|umbrales)$/))) return route.fulfill({ json: admin[m[1]] });
    return route.fulfill({ status: 404, json: { detail: `Ruta sin simular: ${ruta}` } });
  });
}

// Pasos comunes de las pruebas.
export async function abrirVisor(page) {
  await page.goto("/");
  // La lista aparece cuando llegan las estaciones. El mapa se carga en diferido:
  // se espera también su tarjeta de controles, para revisar la página completa.
  await page.locator(".lista, .ficha.vacia").first().waitFor();
  await page.locator(".controles-mapa").waitFor();
}

export async function elegirEstacion(page, nombre) {
  await page.locator(".lista button", { hasText: nombre }).first().click();
  await page.locator("#titulo-ficha").waitFor();
}

export async function irA(page, pestana) {
  await page.getByRole("navigation", { name: "Secciones" }).getByRole("button", { name: pestana, exact: true }).click();
}
