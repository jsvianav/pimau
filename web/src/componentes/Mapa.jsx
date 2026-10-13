import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
// MapLibre 6 dibuja el mapa con un proceso en segundo plano (worker) que va en
// un archivo aparte. Vite lo empaqueta y aquí se le indica a MapLibre dónde está.
import urlProcesoMapa from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { api } from "../api.js";
import { estadoMasReciente, formatearNumero, zonasConEstacion } from "../util.js";

maplibregl.setWorkerUrl(urlProcesoMapa);

const ESTILO_BASE = "https://tiles.openfreemap.org/styles/positron";
const COLOR_SIN_ICA = "#9aa3ad";
const COLOR_SIN_ESCALA = "#0b6fb3";
const CAPAS = [
  { tipo: "comuna", nombre: "Comunas", color: "#2f4a45", visible: true },
  { tipo: "corregimiento", nombre: "Corregimientos", color: "#5b7f63", visible: false },
  { tipo: "barrio", nombre: "Barrios", color: "#8a9a95", visible: false },
];

// Ajustes al mapa base para que el fondo quede en segundo plano y los colores
// del ICA sean lo único que resalte: menos rótulos, calles más claras y agua y
// parques en tonos apagados.
const COLORES_BASE = {
  background: { "background-color": "#f3f5f4" },
  park: { "fill-color": "#e2ece4" },
  landcover_wood: { "fill-color": "#dfe9e0" },
  landuse_residential: { "fill-color": "#eef1ef" },
  water: { "fill-color": "#d4e1e6" },
  waterway: { "line-color": "#d4e1e6" },
  building: { "fill-color": "#e9ecea" },
};
const OCULTAR_BASE = [/^highway-shield/, /^road_shield/, /^highway-name-(path|minor)$/, /^railway/,
                      /^aeroway/, /^airport$/, /^label_(country|state)/,
                      // Toda la plataforma es sobre Cali: el rótulo de la ciudad solo tapa estaciones.
                      /^label_city/];

function suavizarMapaBase(m) {
  for (const capa of m.getStyle().layers) {
    if (OCULTAR_BASE.some((patron) => patron.test(capa.id))) {
      m.setLayoutProperty(capa.id, "visibility", "none");
      continue;
    }
    for (const [propiedad, valor] of Object.entries(COLORES_BASE[capa.id] || {})) {
      m.setPaintProperty(capa.id, propiedad, valor);
    }
    if (capa.type === "symbol" && capa.id.startsWith("label_")) {
      m.setPaintProperty(capa.id, "text-color", "#8a9692");
      m.setPaintProperty(capa.id, "text-opacity", capa.id === "label_other" ? 0.7 : 0.9);
    }
  }
}

function aGeoJSON(grupos, parametro, meta) {
  const conIca = Boolean(meta?.ventana_ica_horas);
  return {
    type: "FeatureCollection",
    features: grupos.map((g) => {
      const actual = estadoMasReciente(g, parametro);
      return {
        type: "Feature",
        id: g.id,
        geometry: { type: "Point", coordinates: g.coordenadas },
        properties: {
          id: g.id,
          nombre: g.nombre,
          // Las variables sin escala del ICA se dibujan en un solo color y con su valor.
          color: conIca ? actual?.estado.color || COLOR_SIN_ICA : COLOR_SIN_ESCALA,
          conDatos: Boolean(actual),
          valor: !conIca && actual ? `${formatearNumero(actual.estado.valor_horario)} ${meta?.unidad || ""}` : "",
        },
      };
    }),
  };
}

export default function Mapa({ grupos, parametro, meta, seleccion, onSeleccionar, onZonas, children }) {
  const contenedor = useRef(null);
  const mapa = useRef(null);
  const [listo, setListo] = useState(false);
  const [capasVisibles, setCapasVisibles] = useState(
    Object.fromEntries(CAPAS.map((c) => [c.tipo, c.visible])));
  const capasVisiblesRef = useRef(capasVisibles);
  // Geometrías de comunas y corregimientos, para colorear la zona de cada estación.
  const geometrias = useRef({});
  const [capasCargadas, setCapasCargadas] = useState(0);
  useEffect(() => { capasVisiblesRef.current = capasVisibles; }, [capasVisibles]);

  useEffect(() => {
    const m = new maplibregl.Map({
      container: contenedor.current,
      style: ESTILO_BASE,
      center: [-76.53, 3.42],
      zoom: 11.6,
      minZoom: 9,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    m.on("load", () => {
      suavizarMapaBase(m);
      const seleccionada = ["boolean", ["feature-state", "seleccionada"], false];
      // Comuna o corregimiento de cada estación, coloreado con su categoría del ICA.
      m.addSource("zonas", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "zonas-relleno", type: "fill", source: "zonas",
                   paint: { "fill-color": ["get", "color"],
                            // Los corregimientos son muy extensos: se colorean más suave que las comunas.
                            "fill-opacity": ["case", ["==", ["get", "tipo"], "corregimiento"], 0.1, 0.22] } });
      m.addLayer({ id: "zonas-borde", type: "line", source: "zonas",
                   paint: { "line-color": ["get", "color"], "line-width": 1.6,
                            "line-opacity": ["case", ["==", ["get", "tipo"], "corregimiento"], 0.45, 0.8] } });
      // Primero las estaciones, para que aparezcan sin esperar las capas.
      m.addSource("estaciones", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      // Halo del color de la categoría: hace visible el estado sin agrandar el punto.
      m.addLayer({
        id: "estaciones-halo", type: "circle", source: "estaciones",
        paint: {
          "circle-radius": ["case", seleccionada, 26, 17],
          "circle-color": ["get", "color"],
          "circle-opacity": ["case", ["get", "conDatos"], ["case", seleccionada, 0.32, 0.22], 0.12],
          "circle-blur": 0.35,
        },
      });
      m.addLayer({
        id: "estaciones", type: "circle", source: "estaciones",
        paint: {
          "circle-radius": ["case", seleccionada, 10, 7.5],
          "circle-color": ["get", "color"],
          "circle-stroke-color": ["case", seleccionada, "#1b2b28", "#ffffff"],
          "circle-stroke-width": ["case", seleccionada, 3, 2.5],
          "circle-opacity": ["case", ["get", "conDatos"], 1, 0.5],
          "circle-stroke-opacity": ["case", ["get", "conDatos"], 1, 0.6],
        },
      });
      m.addLayer({
        id: "estaciones-nombre", type: "symbol", source: "estaciones",
        layout: { "text-field": ["format", ["get", "nombre"], { "text-font": ["literal", ["Noto Sans Bold"]] },
                                 ["case", ["==", ["get", "valor"], ""], "", ["concat", "\n", ["get", "valor"]]],
                                 { "text-font": ["literal", ["Noto Sans Regular"]], "font-scale": 1.05 }],
                  "text-font": ["Noto Sans Regular"], "text-size": 11.5, "text-letter-spacing": 0.01,
                  "text-offset": [0, 1.5], "text-anchor": "top" },
        paint: { "text-color": "#1b2b28", "text-halo-color": "rgba(255,255,255,0.92)", "text-halo-width": 1.8 },
      });
      m.on("click", "estaciones", (e) => onSeleccionar(e.features[0].properties.id));
      m.on("mouseenter", "estaciones", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "estaciones", () => { m.getCanvas().style.cursor = ""; });
      setListo(true);

      // Las capas del territorio se cargan en paralelo y se dibujan debajo de las estaciones.
      for (const capa of CAPAS) {
        api.capa(capa.tipo).then((datos) => {
          if (capa.tipo !== "barrio") {
            geometrias.current[capa.tipo] = datos;
            setCapasCargadas((n) => n + 1);
            onZonas?.({ ...geometrias.current });
          }
          const visibilidad = capasVisiblesRef.current[capa.tipo] ? "visible" : "none";
          m.addSource(`capa-${capa.tipo}`, { type: "geojson", data: datos, generateId: true });
          // Relleno casi transparente que se aclara al pasar el puntero, para
          // ubicar la comuna sin cargar el mapa de color.
          m.addLayer({
            id: `capa-${capa.tipo}-relleno`, type: "fill", source: `capa-${capa.tipo}`,
            layout: { visibility: visibilidad },
            paint: { "fill-color": capa.color,
                     "fill-opacity": ["case", ["boolean", ["feature-state", "encima"], false], 0.07, 0] },
          }, "estaciones-halo");
          m.addLayer({
            id: `capa-${capa.tipo}`, type: "line", source: `capa-${capa.tipo}`,
            layout: { visibility: visibilidad, "line-join": "round" },
            paint: { "line-color": capa.color, "line-width": capa.tipo === "barrio" ? 0.5 : 0.9,
                     "line-opacity": capa.tipo === "barrio" ? 0.35 : 0.4 },
          }, "estaciones-halo");
          if (capa.tipo === "comuna") {
            // Número de cada comuna en el centro de su área, en gris suave.
            m.addLayer({
              id: "capa-comuna-numero", type: "symbol", source: "capa-comuna", minzoom: 9.5,
              layout: { visibility: visibilidad, "text-field": ["to-string", ["to-number", ["get", "codigo"]]],
                        "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 10, 12, 14, 17],
                        "text-allow-overlap": true, "text-ignore-placement": true },
              paint: { "text-color": "#2f4a45", "text-opacity": 0.7,
                       "text-halo-color": "rgba(255,255,255,0.9)", "text-halo-width": 1.6 },
            }, "estaciones-halo");
          }
          let encima = null;
          m.on("mousemove", `capa-${capa.tipo}-relleno`, (e) => {
            if (encima !== null) m.setFeatureState({ source: `capa-${capa.tipo}`, id: encima }, { encima: false });
            encima = e.features[0].id;
            m.setFeatureState({ source: `capa-${capa.tipo}`, id: encima }, { encima: true });
          });
          m.on("mouseleave", `capa-${capa.tipo}-relleno`, () => {
            if (encima !== null) m.setFeatureState({ source: `capa-${capa.tipo}`, id: encima }, { encima: false });
            encima = null;
          });
        }).catch(() => {
          // Si una capa no carga, el mapa sigue funcionando con las estaciones.
        });
      }
    });
    // El contenedor puede cambiar de tamaño después de crear el mapa.
    const observador = new ResizeObserver(() => m.resize());
    observador.observe(contenedor.current);
    mapa.current = m;
    return () => { observador.disconnect(); m.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (listo) mapa.current.getSource("estaciones").setData(aGeoJSON(grupos, parametro, meta));
  }, [listo, grupos, parametro, meta]);

  useEffect(() => {
    if (listo) mapa.current.getSource("zonas").setData(zonasConEstacion(geometrias.current, grupos, parametro));
  }, [listo, grupos, parametro, capasCargadas]);

  // Al llegar las estaciones, el mapa las encuadra todas una sola vez, dejando
  // libre el espacio de las tarjetas que flotan encima en pantallas anchas.
  const encuadrado = useRef(false);
  useEffect(() => {
    if (!listo || encuadrado.current || !grupos.length) return;
    encuadrado.current = true;
    const limites = new maplibregl.LngLatBounds();
    grupos.forEach((g) => limites.extend(g.coordenadas));
    const ancho = window.matchMedia("(min-width: 901px)").matches;
    mapa.current.fitBounds(limites, {
      padding: ancho ? { top: 110, bottom: 60, left: 290, right: 420 } : { top: 200, bottom: 30, left: 30, right: 30 },
      maxZoom: 13, duration: 0,
    });
  }, [listo, grupos]);

  useEffect(() => {
    if (!listo) return;
    const m = mapa.current;
    grupos.forEach((g) => m.setFeatureState({ source: "estaciones", id: g.id }, { seleccionada: g.id === seleccion }));
    const g = grupos.find((x) => x.id === seleccion);
    const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // En pantallas anchas se centra en el espacio libre entre las tarjetas.
    const ancho = window.matchMedia("(min-width: 901px)").matches;
    if (g) m.easeTo({ center: g.coordenadas, duration: sinMovimiento ? 0 : 600,
                      padding: ancho ? { top: 60, bottom: 0, left: 270, right: 400 } : 0 });
  }, [listo, grupos, seleccion]);

  function alternarCapa(tipo) {
    const visible = !capasVisibles[tipo];
    setCapasVisibles({ ...capasVisibles, [tipo]: visible });
    for (const id of [`capa-${tipo}`, `capa-${tipo}-relleno`, `capa-${tipo}-numero`]) {
      if (mapa.current?.getLayer(id)) mapa.current.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    }
  }

  return (
    <>
      <div ref={contenedor} className="mapa" role="region"
           aria-label="Mapa de estaciones. Las estaciones también se pueden elegir en la lista." />
      <div className="flotante controles-mapa">
        {children}
        <fieldset className="selector-capas">
          <legend>Límites del territorio</legend>
          {CAPAS.map((c) => (
            <label key={c.tipo}>
              <input type="checkbox" checked={capasVisibles[c.tipo]} onChange={() => alternarCapa(c.tipo)} />
              <span className="muestra-linea" style={{ borderColor: c.color }} aria-hidden="true" /> {c.nombre}
            </label>
          ))}
        </fieldset>
      </div>
    </>
  );
}
