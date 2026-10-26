// Solo en desarrollo: cambia las respuestas de la API por casos extremos para
// ver dónde se rompe la interfaz (nombres largos, sin datos, errores). Se elige
// con ?datos=peor, ?datos=vacio o ?datos=error y nunca llega a producción,
// porque main.jsx solo lo importa con import.meta.env.DEV.

const CASOS = [
  ["demo", "Datos reales"],
  ["peor", "Peor caso"],
  ["vacio", "Sin datos"],
  ["error", "Error de la API"],
];

const caso = new URLSearchParams(window.location.search).get("datos") || "demo";

// Valores plausibles: nombres que existen en Cali, fuentes con su nombre
// completo y mensajes de error reales de la descarga de SATIC.
const NOMBRES_LARGOS = [
  "Institución Educativa Técnico Industrial Antonio José Camacho - Sede Principal",
  "Sur",
  "Colegio Nuestra Señora de los Andes y del Perpetuo Socorro",
];
const FUENTE_LARGA = "Sistema de Alertas Tempranas Ambientales de Cali - SATIC (red OAC22, sensores de bajo costo)";
const MENSAJE_LARGO = "Advertencia: la descarga automática de SATIC falla desde el 2026-10-22 02:44 UTC "
  + "(TimeoutError:Page.wait_for_selector:Timeout_60000ms_exceeded_waiting_for_locator('#tablaDatosEstacion'))";

function horasAtras(horas) {
  return new Date(Date.now() - horas * 3600000).toISOString();
}

function peorEstaciones(geojson) {
  const features = geojson.features.map((f, i) => {
    const p = structuredClone(f.properties);
    if (i < NOMBRES_LARGOS.length) p.nombre = NOMBRES_LARGOS[i];
    if (i === 0) p.fuente = FUENTE_LARGA;
    const pm = p.parametros.PM25;
    if (pm && i === 0) {
      // Dato reciente, en el tope de la escala, con alerta y anomalía.
      Object.assign(pm, { instante: horasAtras(1), instante_ica: horasAtras(1), valor_horario: 1234.5,
                          promedio_ica: 987.6, ica: 500, categoria: "Peligrosa", color: "#7E0023",
                          anomalias_48h: 1, ultima_anomala: true,
                          ultima_marcada: { instante: horasAtras(0.5), bandera: "sospechoso" } });
    }
    if (pm && i === 1) {
      Object.assign(pm, { instante: horasAtras(3), valor_horario: 0, categoria: null, ica: null, color: null,
                          anomalias_48h: 37, ultima_anomala: false });
    }
    return { ...f, properties: p };
  });
  return { ...geojson, features };
}

function peorAlertas(estaciones) {
  // Doce alertas: la lista empuja la ficha hacia abajo en el panel.
  return estaciones.features.slice(0, 12).map((f, i) => ({
    estacion_id: f.properties.id, estacion: NOMBRES_LARGOS[i] || f.properties.nombre, parametro: "PM25",
    valor: 1234.5 - i, umbral: 37, unidad: "µg/m³", instante: horasAtras(i + 1),
  }));
}

function peorFuentes(fuentes) {
  return fuentes.map((f, i) => (i === 0
    ? { ...f, nombre: FUENTE_LARGA, ultima_ejecucion: { ...f.ultima_ejecucion, estado: "con_error", mensaje: MENSAJE_LARGO,
                                                         registros: 1234567 } }
    : f));
}

function peorAuditoria(eventos) {
  return [{ instante: horasAtras(0.1), administrador: "bartholomew.fitzgerald@secretaria-de-ambiente.cali.gov.co",
            accion: "cambiar_umbral PM25: 37 → 1234,5", resultado: "rechazado",
            ip: "2001:0db8:85a3:0000:0000:8a2e:0370:7334" }, ...eventos];
}

const original = window.fetch.bind(window);

function json(datos, estado = 200) {
  return Promise.resolve(new Response(JSON.stringify(datos), { status: estado,
                                                                headers: { "Content-Type": "application/json" } }));
}

let estacionesPeor = null;

window.fetch = async (recurso, opciones) => {
  const ruta = typeof recurso === "string" ? recurso : recurso.url;
  if (caso === "demo" || !ruta.startsWith("/api/")) return original(recurso, opciones);
  const camino = ruta.split("?")[0];
  if (caso === "error" && !camino.startsWith("/api/capas")) {
    return json({ detail: "La base de datos no respondió a tiempo (tiempo de espera de 30 s agotado)" }, 503);
  }
  if (caso === "vacio") {
    if (camino === "/api/estaciones") return json({ type: "FeatureCollection", features: [] });
    if (camino === "/api/alertas") return json([]);
  }
  if (caso === "peor") {
    if (camino === "/api/estaciones") {
      estacionesPeor = peorEstaciones(await (await original(recurso, opciones)).json());
      return json(estacionesPeor);
    }
    if (camino === "/api/alertas") {
      if (!estacionesPeor) estacionesPeor = peorEstaciones(await (await original("/api/estaciones")).json());
      return json(peorAlertas(estacionesPeor));
    }
    if (camino === "/api/admin/fuentes") return json(peorFuentes(await (await original(recurso, opciones)).json()));
    if (camino === "/api/admin/auditoria") return json(peorAuditoria(await (await original(recurso, opciones)).json()));
  }
  return original(recurso, opciones);
};

// Selector fijo abajo al centro, fuera del diseño que se prueba.
const barra = document.createElement("nav");
barra.setAttribute("aria-label", "Datos de prueba (solo en desarrollo)");
barra.style.cssText = "position:fixed;bottom:12px;left:0;right:0;margin:0 auto;width:max-content;max-width:calc(100% - 16px);"
  + "z-index:99;display:flex;flex-wrap:wrap;gap:2px;"
  + "padding:3px;border-radius:999px;background:#e4e4e7;font:12px system-ui;box-shadow:0 1px 4px rgba(0,0,0,.2)";
for (const [valor, texto] of CASOS) {
  const enlace = document.createElement("a");
  const url = new URL(window.location.href);
  if (valor === "demo") url.searchParams.delete("datos"); else url.searchParams.set("datos", valor);
  enlace.href = url.toString();
  enlace.textContent = texto;
  enlace.style.cssText = "padding:4px 10px;border-radius:999px;color:#18181b;text-decoration:none;"
    + (valor === caso ? "background:#fff;font-weight:600" : "");
  if (valor === caso) enlace.setAttribute("aria-current", "true");
  barra.append(enlace);
}
document.body.append(barra);
