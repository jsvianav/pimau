import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { api } from "../api.js";
import { estadoMasReciente, formatearNumero } from "../util.js";

const ESTILO_BASE = "https://tiles.openfreemap.org/styles/positron";
const COLOR_SIN_ICA = "#9aa3ad";
const COLOR_SIN_ESCALA = "#0b6fb3";
const CAPAS = [
  { tipo: "comuna", nombre: "Comunas", color: "#17322e", visible: true },
  { tipo: "corregimiento", nombre: "Corregimientos", color: "#5b7f63", visible: false },
  { tipo: "barrio", nombre: "Barrios", color: "#8a9a95", visible: false },
];

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

export default function Mapa({ grupos, parametro, meta, seleccion, onSeleccionar, children }) {
  const contenedor = useRef(null);
  const mapa = useRef(null);
  const [listo, setListo] = useState(false);
  const [capasVisibles, setCapasVisibles] = useState(
    Object.fromEntries(CAPAS.map((c) => [c.tipo, c.visible])));
  const capasVisiblesRef = useRef(capasVisibles);
  capasVisiblesRef.current = capasVisibles;

  useEffect(() => {
    const m = new maplibregl.Map({
      container: contenedor.current,
      style: ESTILO_BASE,
      center: [-76.52, 3.40],
      zoom: 11,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      // Primero las estaciones, para que aparezcan sin esperar las capas.
      m.addSource("estaciones", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "estaciones", type: "circle", source: "estaciones",
        paint: {
          "circle-radius": ["case", ["boolean", ["feature-state", "seleccionada"], false], 12, 9],
          "circle-color": ["get", "color"],
          "circle-stroke-color": ["case", ["boolean", ["feature-state", "seleccionada"], false], "#17322e", "#fff"],
          "circle-stroke-width": ["case", ["boolean", ["feature-state", "seleccionada"], false], 3, 2],
          "circle-opacity": ["case", ["get", "conDatos"], 1, 0.45],
        },
      });
      m.addLayer({
        id: "estaciones-nombre", type: "symbol", source: "estaciones",
        layout: { "text-field": ["format", ["get", "nombre"], {},
                                 ["case", ["==", ["get", "valor"], ""], "", ["concat", "\n", ["get", "valor"]]], { "font-scale": 1.1 }],
                  "text-font": ["Noto Sans Regular"], "text-size": 11,
                  "text-offset": [0, 1.3], "text-anchor": "top" },
        paint: { "text-color": "#17322e", "text-halo-color": "#fff", "text-halo-width": 1.6 },
      });
      m.on("click", "estaciones", (e) => onSeleccionar(e.features[0].properties.id));
      m.on("mouseenter", "estaciones", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "estaciones", () => { m.getCanvas().style.cursor = ""; });
      setListo(true);

      // Las capas del territorio se cargan en paralelo y se dibujan debajo de las estaciones.
      for (const capa of CAPAS) {
        api.capa(capa.tipo).then((datos) => {
          m.addSource(`capa-${capa.tipo}`, { type: "geojson", data: datos });
          m.addLayer({
            id: `capa-${capa.tipo}`, type: "line", source: `capa-${capa.tipo}`,
            layout: { visibility: capasVisiblesRef.current[capa.tipo] ? "visible" : "none" },
            paint: { "line-color": capa.color, "line-width": capa.tipo === "barrio" ? 0.6 : 1.1, "line-opacity": 0.55 },
          }, "estaciones");
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
    if (!listo) return;
    const m = mapa.current;
    grupos.forEach((g) => m.setFeatureState({ source: "estaciones", id: g.id }, { seleccionada: g.id === seleccion }));
    const g = grupos.find((x) => x.id === seleccion);
    const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (g) m.easeTo({ center: g.coordenadas, duration: sinMovimiento ? 0 : 600 });
  }, [listo, grupos, seleccion]);

  function alternarCapa(tipo) {
    const visible = !capasVisibles[tipo];
    setCapasVisibles({ ...capasVisibles, [tipo]: visible });
    if (mapa.current?.getLayer(`capa-${tipo}`)) {
      mapa.current.setLayoutProperty(`capa-${tipo}`, "visibility", visible ? "visible" : "none");
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
