import { useState } from "react";

// Aviso de error en tres partes: qué pasó (título), qué significa o qué hacer
// (mensaje y acción) y, plegado, el detalle técnico con un botón para copiarlo.
// `error` puede ser un texto o un ErrorApi (api.js).
export default function AvisoError({ titulo, error, onReintentar }) {
  const [copia, setCopia] = useState(null);
  const mensaje = typeof error === "string" ? error : error?.message;
  const detalle = typeof error === "string" ? null : error?.detalle;

  function copiar() {
    // Sin permiso o fuera de HTTPS el portapapeles no existe o rechaza la escritura.
    const fallo = () => setCopia("No se pudo copiar. Selecciónelo y cópielo a mano.");
    if (!navigator.clipboard) return fallo();
    navigator.clipboard.writeText(detalle).then(() => setCopia("Detalle copiado."), fallo);
  }

  return (
    <div className={`aviso error${onReintentar ? " con-accion" : ""}`} role="alert">
      <div className="aviso-error-texto">
        <p>{titulo && <strong>{titulo} </strong>}{mensaje}</p>
        {detalle && (
          <details className="detalle-tecnico">
            <summary>Detalle técnico</summary>
            <code>{detalle}</code>
            <button className="boton texto" type="button" onClick={copiar}>Copiar el detalle</button>
            {copia && <span role="status">{copia}</span>}
          </details>
        )}
      </div>
      {onReintentar && <button className="boton" type="button" onClick={onReintentar}>Reintentar</button>}
    </div>
  );
}
