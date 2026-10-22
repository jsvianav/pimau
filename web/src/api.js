// Cliente de la API de PIMAU. Todas las rutas son relativas a /api.

export class ErrorApi extends Error {
  constructor(mensaje, estado) {
    super(mensaje);
    this.estado = estado;
  }
}

async function obtener(ruta, opciones = {}) {
  const respuesta = await fetch(ruta, opciones);
  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => ({}));
    // FastAPI devuelve los errores de validación como una lista.
    const detalle = Array.isArray(cuerpo.detail) ? "Revise los valores enviados" : cuerpo.detail;
    throw new ErrorApi(detalle || `Error ${respuesta.status} al consultar ${ruta}`, respuesta.status);
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
