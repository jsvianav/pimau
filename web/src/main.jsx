import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/public-sans/index.css";
import "@fontsource-variable/bricolage-grotesque/index.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./estilos.css";
import App from "./App.jsx";

createRoot(document.getElementById("raiz")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
