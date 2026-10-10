// Cliente de la API de PIMAU. Todas las rutas son relativas a /api.

async function obtener(ruta) {
  const respuesta = await fetch(ruta);
  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => ({}));
    throw new Error(cuerpo.detail || `Error ${respuesta.status} al consultar ${ruta}`);
  }
  return respuesta.json();
}

export const api = {
  estaciones: () => obtener("/api/estaciones"),
  umbrales: () => obtener("/api/umbrales"),
  parametros: () => obtener("/api/parametros"),
  capa: (tipo) => obtener(`/api/capas/${tipo}`),
  rango: (id, parametro) => obtener(`/api/estaciones/${id}/rango?parametro=${parametro}`),
  serie: (id, p) => obtener(`/api/estaciones/${id}/series?${new URLSearchParams(p)}`),
  urlCsv: (id, p) => `/api/estaciones/${id}/series.csv?${new URLSearchParams(p)}`,
  urlSerie: (id, p) => `/api/estaciones/${id}/series?${new URLSearchParams(p)}`,
};
