import { Children, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
// MapLibre 6 dibuja el mapa con un proceso en segundo plano (worker) que va en
// un archivo aparte. Vite lo empaqueta y aquí se le indica a MapLibre dónde está.
import urlProcesoMapa from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { api } from "../api.js";
import { estadoMasReciente, formatearNumero, zonasConEstacion } from "../util.js";

maplibregl.setWorkerUrl(urlProcesoMapa);

const COLOR_SIN_ESCALA = "#0b6fb3";
// Color de estado "crítico" de la paleta validada: reservado para las alertas.
export const COLOR_ALERTA = "#d03b3b";
// Textos de los controles de MapLibre en español, para el lector de pantalla.
const TEXTOS_MAPA = {
  "Map.Title": "Mapa",
  "NavigationControl.ZoomIn": "Acercar",
  "NavigationControl.ZoomOut": "Alejar",
  "AttributionControl.ToggleAttribution": "Mostrar u ocultar las fuentes del mapa base",
  "CooperativeGesturesHandler.MobileHelpText": "Use dos dedos para mover el mapa",
  "CooperativeGesturesHandler.WindowsHelpText": "Use Ctrl + rueda para acercar el mapa",
  "CooperativeGesturesHandler.MacHelpText": "Use ⌘ + rueda para acercar el mapa",
};
const CAPAS = [
  { tipo: "comuna", nombre: "Comunas", visible: true },
  { tipo: "corregimiento", nombre: "Corregimientos", visible: false },
  { tipo: "barrio", nombre: "Barrios", visible: false },
];

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

function suavizarMapaBase(m, tema) {
  for (const capa of m.getStyle().layers) {
    if (tema.ocultar.some((patron) => patron.test(capa.id))) {
      m.setLayoutProperty(capa.id, "visibility", "none");
      continue;
    }
    for (const [propiedad, valor] of Object.entries(tema.base[capa.id] || {})) {
      m.setPaintProperty(capa.id, propiedad, valor);
    }
    if (capa.type === "symbol" && tema.rotulos.test(capa.id)) {
      m.setPaintProperty(capa.id, "text-color", tema.rotuloBase);
      m.setPaintProperty(capa.id, "text-opacity", /_other$/.test(capa.id) ? 0.7 : 0.9);
    }
  }
}

function aGeoJSON(grupos, parametro, meta, opciones, alertas, tema) {
  const conIca = Boolean(meta?.ventana_ica_horas);
  return {
    type: "FeatureCollection",
    features: grupos.map((g) => {
      const actual = estadoMasReciente(g, parametro, opciones);
      return {
        type: "Feature",
        id: g.id,
        geometry: { type: "Point", coordinates: g.coordenadas },
        properties: {
          id: g.id,
          nombre: g.nombre,
          // Las variables sin escala del ICA se dibujan en un solo color y con su valor.
          color: conIca ? actual?.estado.color || tema.sinIca : COLOR_SIN_ESCALA,
          conDatos: Boolean(actual),
          // RF-14: la estación tiene una alerta activa de esta variable.
          alerta: alertas.some((a) => a.parametro === parametro && g.registros.some((r) => r.id === a.estacion_id)),
          // RF-13: su último dato fue señalado como anómalo.
          anomala: Boolean(actual?.estado.ultima_anomala),
          valor: !conIca && actual ? `${formatearNumero(actual.estado.valor_horario)} ${meta?.unidad || ""}` : "",
        },
      };
    }),
  };
}

export default function Mapa({ grupos, parametro, meta, seleccion, onSeleccionar, onZonas, opciones, alertas = [],
                               tema = TEMAS_MAPA.claro, children }) {
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
      style: tema.estilo,
      center: [-76.53, 3.42],
      zoom: 11.6,
      minZoom: 9,
      attributionControl: { compact: true },
      locale: TEXTOS_MAPA,
      // En una pantalla táctil el mapa ocupa casi todo el ancho: con un dedo se
      // desplaza la página y con dos se mueve el mapa, para no quedar atrapado.
      cooperativeGestures: window.matchMedia("(pointer: coarse)").matches,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    m.on("load", () => {
      suavizarMapaBase(m, tema);
      const seleccionada = ["boolean", ["feature-state", "seleccionada"], false];
      // Comuna o corregimiento de cada estación, coloreado con su categoría del ICA.
      m.addSource("zonas", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "zonas-relleno", type: "fill", source: "zonas",
                   paint: { "fill-color": ["get", "color"],
                            // Los corregimientos son muy extensos: se colorean más suave que las comunas.
                            "fill-opacity": ["case", ["==", ["get", "tipo"], "corregimiento"], tema.zonas[1], tema.zonas[0]] } });
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
          // Sin datos (o sin datos recientes) la estación no lleva halo.
          "circle-opacity": ["case", ["get", "conDatos"], ["case", seleccionada, 0.32, 0.22], 0],
          "circle-blur": 0.35,
        },
      });
      // Anillos de estado, entre el halo y el punto: alerta (rojo) y anomalía (oscuro, más cerca).
      m.addLayer({
        id: "estaciones-alerta", type: "circle", source: "estaciones", filter: ["get", "alerta"],
        paint: { "circle-radius": 15, "circle-color": "rgba(0,0,0,0)",
                 "circle-stroke-color": COLOR_ALERTA, "circle-stroke-width": 3 },
      });
      m.addLayer({
        id: "estaciones-anomalia", type: "circle", source: "estaciones", filter: ["get", "anomala"],
        paint: { "circle-radius": 11.5, "circle-color": "rgba(0,0,0,0)",
                 "circle-stroke-color": tema.anomalia, "circle-stroke-width": 1.5 },
      });
      m.addLayer({
        id: "estaciones", type: "circle", source: "estaciones",
        // Las estaciones sin datos se dibujan como un aro gris hueco, para que
        // ningún color sugiera un estado del aire que no se conoce.
        paint: {
          "circle-radius": ["case", seleccionada, 10, ["get", "conDatos"], 7.5, 5],
          "circle-color": ["case", ["get", "conDatos"], ["get", "color"], tema.hueco],
          "circle-stroke-color": ["case", seleccionada, tema.seleccion, ["get", "conDatos"], tema.contorno, tema.sinIca],
          "circle-stroke-width": ["case", seleccionada, 3, ["get", "conDatos"], 2.5, 2],
        },
      });
      m.addLayer({
        id: "estaciones-nombre", type: "symbol", source: "estaciones",
        layout: { "text-field": ["format", ["get", "nombre"], { "text-font": ["literal", ["Noto Sans Bold"]] },
                                 ["case", ["==", ["get", "valor"], ""], "", ["concat", "\n", ["get", "valor"]]],
                                 { "text-font": ["literal", ["Noto Sans Regular"]], "font-scale": 1.05 }],
                  "text-font": ["Noto Sans Regular"], "text-size": 11.5, "text-letter-spacing": 0.01,
                  "text-offset": [0, 1.5], "text-anchor": "top" },
        paint: { "text-color": ["case", ["get", "conDatos"], tema.texto, tema.textoSinDatos],
                 "text-halo-color": tema.halo, "text-halo-width": 1.8 },
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
            paint: { "fill-color": tema.capas[capa.tipo],
                     "fill-opacity": ["case", ["boolean", ["feature-state", "encima"], false], 0.07, 0] },
          }, "estaciones-halo");
          m.addLayer({
            id: `capa-${capa.tipo}`, type: "line", source: `capa-${capa.tipo}`,
            layout: { visibility: visibilidad, "line-join": "round" },
            paint: { "line-color": tema.capas[capa.tipo], "line-width": capa.tipo === "barrio" ? 0.5 : 0.9,
                     "line-opacity": capa.tipo === "barrio" ? 0.35 : 0.4 },
          }, "estaciones-halo");
          if (capa.tipo === "comuna") {
            // Número de cada comuna en el centro de su área, en gris suave.
            m.addLayer({
              id: "capa-comuna-numero", type: "symbol", source: "capa-comuna", minzoom: 9.5,
              layout: { visibility: visibilidad, "text-field": ["to-string", ["to-number", ["get", "codigo"]]],
                        "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 10, 12, 14, 17],
                        "text-allow-overlap": true, "text-ignore-placement": true },
              paint: { "text-color": tema.capas.comuna, "text-opacity": 0.7,
                       "text-halo-color": tema.halo, "text-halo-width": 1.6 },
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
    if (listo) mapa.current.getSource("estaciones")?.setData(aGeoJSON(grupos, parametro, meta, opciones, alertas, tema));
  }, [listo, grupos, parametro, meta, opciones, alertas, tema]);

  useEffect(() => {
    if (listo) mapa.current.getSource("zonas")?.setData(zonasConEstacion(geometrias.current, grupos, parametro, opciones));
  }, [listo, grupos, parametro, capasCargadas, opciones]);

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
    grupos.forEach((g) => mapa.current.setFeatureState({ source: "estaciones", id: g.id }, { seleccionada: g.id === seleccion }));
  }, [listo, grupos, seleccion]);

  // El mapa se mueve solo cuando cambia la estación elegida, no cada vez que
  // llegan datos nuevos: si no, cada diez minutos volvería a la estación aunque
  // la persona haya movido el mapa.
  const gruposRef = useRef(grupos);
  useEffect(() => { gruposRef.current = grupos; }, [grupos]);
  useEffect(() => {
    if (!listo) return;
    const g = gruposRef.current.find((x) => x.id === seleccion);
    const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // En pantallas anchas se centra en el espacio libre entre las tarjetas.
    const ancho = window.matchMedia("(min-width: 901px)").matches;
    if (g) mapa.current.easeTo({ center: g.coordenadas, duration: sinMovimiento ? 0 : 600,
                                 padding: ancho ? { top: 60, bottom: 0, left: 270, right: 400 } : 0 });
  }, [listo, seleccion]);

  function alternarCapa(tipo) {
    const visible = !capasVisibles[tipo];
    setCapasVisibles({ ...capasVisibles, [tipo]: visible });
    for (const id of [`capa-${tipo}`, `capa-${tipo}-relleno`, `capa-${tipo}-numero`]) {
      if (mapa.current?.getLayer(id)) mapa.current.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    }
  }

  // El primer control (la variable) siempre se ve. Los demás se pliegan en
  // pantallas pequeñas para que la tarjeta no tape el mapa. En pantallas anchas
  // no hay cómo plegarlos, así que se abren si la ventana se agranda.
  const [principal, ...demas] = Children.toArray(children);
  const [abierto, setAbierto] = useState(() => !window.matchMedia("(max-width: 900px)").matches);
  useEffect(() => {
    const ancho = window.matchMedia("(min-width: 901px)");
    const alCambiar = () => { if (ancho.matches) setAbierto(true); };
    ancho.addEventListener("change", alCambiar);
    return () => ancho.removeEventListener("change", alCambiar);
  }, []);

  return (
    <>
      <div ref={contenedor} className="mapa" role="region"
           aria-label="Mapa de estaciones. Las estaciones también se pueden elegir en la lista." />
      <div className="flotante controles-mapa">
        {principal}
        <details className="mas-opciones" open={abierto} onToggle={(e) => setAbierto(e.currentTarget.open)}>
          <summary>Vigencia y límites del territorio</summary>
          {demas}
          <fieldset className="selector-capas">
            <legend>Límites del territorio</legend>
            {CAPAS.map((c) => (
              <label key={c.tipo}>
                <input type="checkbox" checked={capasVisibles[c.tipo]} onChange={() => alternarCapa(c.tipo)} />
                <span className="muestra-linea" style={{ borderColor: tema.capas[c.tipo] }} aria-hidden="true" /> {c.nombre}
              </label>
            ))}
          </fieldset>
        </details>
      </div>
    </>
  );
}
