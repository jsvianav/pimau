// Cliente de la API de PIMAU. Todas las rutas son relativas a /api.

// El mensaje es para la persona; el detalle técnico (código HTTP, ruta, error de
// red) va aparte, para copiarlo y enviarlo a soporte sin ponerlo en primer plano.
export class ErrorApi extends Error {
  constructor(mensaje, estado, detalle = null) {
    super(mensaje);
    this.estado = estado;
    this.detalle = detalle;
  }
}

async function obtener(ruta, opciones = {}) {
  let respuesta;
  try {
    respuesta = await fetch(ruta, opciones);
  } catch (e) {
    throw new ErrorApi("No hubo conexión con la plataforma.", 0, `${e.message} (${ruta})`);
  }
  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => ({}));
    const tecnico = `HTTP ${respuesta.status} en ${ruta}`;
    // La API explica sus errores en una frase; FastAPI devuelve los de validación como una lista.
    if (typeof cuerpo.detail === "string") throw new ErrorApi(cuerpo.detail, respuesta.status, tecnico);
    if (Array.isArray(cuerpo.detail)) {
      throw new ErrorApi("Revise los valores enviados.", respuesta.status, `${tecnico}: ${JSON.stringify(cuerpo.detail)}`);
    }
    throw new ErrorApi("La plataforma no respondió como se esperaba.", respuesta.status, tecnico);
  }
  return respuesta.json();
}

function conToken(token, opciones = {}) {
  return { ...opciones, headers: { ...opciones.headers, Authorization: `Bearer ${token}` } };
}

const JSON_CABECERA = { "Content-Type": "application/json" };

export const api = {
  estaciones: () => obtener("/api/estaciones"),
  umbrales: () => obtener("/api/umbrales"),
  parametros: () => obtener("/api/parametros"),
  capa: (tipo) => obtener(`/api/capas/${tipo}`),
  alertas: () => obtener("/api/alertas"),
  rango: (id, parametro) => obtener(`/api/estaciones/${id}/rango?parametro=${parametro}`),
  serie: (id, p) => obtener(`/api/estaciones/${id}/series?${new URLSearchParams(p)}`),
  urlCsv: (id, p) => `/api/estaciones/${id}/series.csv?${new URLSearchParams(p)}`,
  urlSerie: (id, p) => `/api/estaciones/${id}/series?${new URLSearchParams(p)}`,
};

// Administración (incremento 3). Cada llamada lleva el token de la sesión.
export const apiAdmin = {
  iniciarSesion: (correo, clave) =>
    obtener("/api/admin/sesion", { method: "POST", headers: JSON_CABECERA, body: JSON.stringify({ correo, clave }) }),
  fuentes: (token) => obtener("/api/admin/fuentes", conToken(token)),
  cambiarFuente: (token, id, cambios) =>
    obtener(`/api/admin/fuentes/${id}`, conToken(token, { method: "PATCH", headers: JSON_CABECERA, body: JSON.stringify(cambios) })),
  ejecuciones: (token, p) => obtener(`/api/admin/ejecuciones?${new URLSearchParams(p)}`, conToken(token)),
  auditoria: (token) => obtener("/api/admin/auditoria?limite=20", conToken(token)),
  umbrales: (token) => obtener("/api/admin/umbrales", conToken(token)),
  configurarUmbral: (token, codigo, cambio) =>
    obtener(`/api/admin/umbrales/${codigo}`, conToken(token, { method: "PUT", headers: JSON_CABECERA, body: JSON.stringify(cambio) })),
};
