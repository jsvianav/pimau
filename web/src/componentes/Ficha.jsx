import { lazy, Suspense, useState } from "react";
import { antiguedad, esReciente, fechaCorta, formatearFecha, formatearNumero, nombreCorto, periodoRuido, zonaDe } from "../util.js";
import { COLOR_ALERTA } from "./Mapa.jsx";

// La gráfica de las últimas 48 horas usa Recharts (unos 100 kB comprimidos):
// se descarga al abrir una estación con datos recientes, no con la página.
const UltimasHoras = lazy(() => import("./UltimasHoras.jsx"));

const RANGOS_INDICE = [[0, 50], [51, 100], [101, 150], [151, 200], [201, 300], [301, 500]];
const COLORES_ICA = ["#00E400", "#FFFF00", "#FF7E00", "#FF0000", "#8F3F97", "#7E0023"];

// Posición del marcador sobre seis segmentos iguales: cada categoría ocupa lo
// mismo, aunque sus rangos del índice no midan lo mismo.
function posicionEnEscala(ica) {
  const i = RANGOS_INDICE.findIndex(([, alto]) => ica <= alto);
  const [bajo, alto] = RANGOS_INDICE[i === -1 ? 5 : i];
  const fraccion = Math.min(1, Math.max(0, (ica - bajo) / (alto - bajo)));
  return { indice: i === -1 ? 5 : i, porcentaje: (((i === -1 ? 5 : i) + fraccion) / 6) * 100 };
}

function EscalaIca({ estado }) {
  if (!estado.ventana_ica_horas) return null;
  if (!estado.categoria) {
    const minimo = Math.ceil(estado.ventana_ica_horas * 0.75);
    return (
      <p className="sin-ica">
        No se puede calcular el ICA: ningún periodo de esta serie tiene las {minimo} de {estado.ventana_ica_horas}{" "}
        horas válidas que exige el cálculo, o el valor está fuera de la escala de {estado.ventana_ica_horas} horas.
      </p>
    );
  }
  const { indice, porcentaje } = posicionEnEscala(estado.ica);
  return (
    <div className="escala">
      <p className="escala-categoria">
        <strong>{estado.categoria}</strong>
        <span>ICA {estado.ica}</span>
      </p>
      <div className="escala-barra" role="img"
           aria-label={`ICA ${estado.ica}, categoría ${estado.categoria}, en una escala de 0 a 500`}>
        {COLORES_ICA.map((color, i) => (
          <span key={color} className={i === indice ? "segmento actual" : "segmento"} style={{ background: color }} />
        ))}
        {/* La posición va en una variable de CSS: el marcador se desliza con
            transform dentro de la barra, sin salirse de ella (ver estilos.css). */}
        <span className="escala-marcador" style={{ "--posicion": porcentaje }} />
      </div>
      <div className="escala-extremos" aria-hidden="true"><span>Buena</span><span>Peligrosa</span></div>
      <p className="escala-detalle">
        {estado.ventana_ica_horas === 1
          ? <>Valor de {formatearNumero(estado.promedio_ica)} µg/m³ en la hora que termina el {formatearFecha(estado.instante_ica)}.</>
          : <>Promedio de {formatearNumero(estado.promedio_ica)} µg/m³ en las {estado.ventana_ica_horas} horas que terminan
              el {formatearFecha(estado.instante_ica)}, con {estado.horas_validas_ica} horas válidas.</>}
      </p>
    </div>
  );
}

function GuiaOms({ estado }) {
  const guia = estado.guia_oms;
  if (!guia) return null;
  if (guia.comparable && estado.promedio_ica != null) {
    const supera = estado.promedio_ica > guia.valor;
    return (
      <p className="oms">
        La guía de la OMS recomienda no superar {formatearNumero(guia.valor)} µg/m³ en {guia.periodo}. Ese promedio{" "}
        {supera ? "la supera" : "está por debajo"}.
      </p>
    );
  }
  return (
    <p className="oms">
      Guía de la OMS: {formatearNumero(guia.valor)} µg/m³ como promedio de {guia.periodo}. No se compara porque el ICA
      usa otro periodo.
    </p>
  );
}

// Cada aviso dice en una línea qué pasa; el porqué va plegado en «¿Qué
// significa?», para que la ficha no se llene de párrafos.
function Detalle({ children }) {
  return (
    <details className="aviso-detalle">
      <summary>¿Qué significa?</summary>
      <p>{children}</p>
    </details>
  );
}

// Los sensores de la red OAC22 son de bajo costo: en los 30 días revisados su
// PM10 fue casi igual a su PM2.5 (razón de 1,00 a 1,12), cuando el PM10 incluye
// al PM2.5 y suele ser bastante mayor (docs/bitacora.md, 2026-10-22).
const NOTAS_FUENTE = {
  "SATIC (red OAC22)": {
    PM10: ["Sus sensores son de bajo costo: este PM10 y su ICA probablemente están por debajo del real.",
           "En los 30 días revisados, el PM10 de esta red fue casi igual a su PM2.5 (razón de 1,00 a 1,12), cuando el "
           + "PM10 incluye al PM2.5 y suele ser bastante mayor."],
  },
};

const MOTIVO_MARCA = {
  sospechoso: ["el sensor repite el mismo valor", "Seis o más horas seguidas con el mismo valor indican una falla del sensor."],
  fuera_de_rango: ["el valor está fuera del rango posible", "Un valor que no puede darse en la realidad se trata como un error "
    + "de medición."],
};

function AvisoMarcada({ marcada, hayValido, ahora }) {
  if (!marcada) return null;
  const [motivo, explicacion] = MOTIVO_MARCA[marcada.bandera] || MOTIVO_MARCA.fuera_de_rango;
  return (
    <div className="aviso-calidad" role="note">
      <p>
        <strong>Datos no confiables</strong> {hayValido ? "Las horas siguientes al último dato válido" : "Las últimas mediciones"}{" "}
        están marcadas porque {motivo} (última: {fechaCorta(marcada.instante, ahora)}).
      </p>
      <Detalle>{explicacion} Esas horas no se usan para el ICA{hayValido ? ", que se calcula con el último dato válido" : ""}.</Detalle>
    </div>
  );
}

function AvisoAnomalias({ estado }) {
  if (!estado.anomalias_48h) return null;
  const n = estado.anomalias_48h;
  return (
    <div className="aviso-anomalia" role="note">
      <p>
        <strong>{estado.ultima_anomala || n === 1 ? "Valor anómalo" : "Valores anómalos"}</strong>{" "}
        {estado.ultima_anomala ? "El último dato se sale del patrón de esta serie."
          : `${n} ${n === 1 ? "valor de las últimas 48 horas se sale" : "valores de las últimas 48 horas se salen"} del patrón de esta serie.`}
      </p>
      <Detalle>
        Los señala la detección de anomalías (Isolation Forest), entrenada con el último año de la serie. Puede ser una
        falla del sensor o un evento real, como una quema: el valor no se modifica.
      </Detalle>
    </div>
  );
}

function AvisoAlerta({ alerta, ahora }) {
  if (!alerta) return null;
  return (
    <div className="aviso-alerta" role="alert" style={{ borderColor: COLOR_ALERTA }}>
      <p>
        <strong>Alerta</strong> {formatearNumero(alerta.valor)} {alerta.unidad} ({fechaCorta(alerta.instante, ahora)}) iguala o
        supera el umbral de {formatearNumero(alerta.umbral)} {alerta.unidad} fijado para {nombreCorto(alerta.parametro)}.
      </p>
    </div>
  );
}

// Ruido (RF-15): se compara con el límite de la Resolución 627 de 2006 del
// periodo (día o noche) en que se midió.
function NormaRuido({ estado, umbrales }) {
  const limites = umbrales?.RUIDO?.ruido;
  if (!limites?.["Día"]) return null;
  const periodo = periodoRuido(estado.instante);
  const limite = limites[periodo];
  const supera = estado.valor_horario > limite;
  return (
    <p className="oms">
      La Resolución 627 de 2006 fija {formatearNumero(limite)} dB(A) {periodo === "Día" ? "de día" : "de noche"} en zonas
      residenciales, universidades y colegios (sector B). Este valor, medido {periodo === "Día" ? "de día" : "de noche"},{" "}
      {supera ? "lo supera" : "está por debajo"}. El límite exacto depende del uso del suelo de la estación.
    </p>
  );
}

function DatoFuente({ registro, parametro, meta, onVerHistorico, ahora, alertas, umbrales }) {
  const estado = registro.parametros[parametro];
  const nombre = nombreCorto(parametro);
  const nota = NOTAS_FUENTE[registro.fuente]?.[parametro];
  if (!estado) {
    return (
      <section className="fuente-dato">
        <h3>{registro.fuente}</h3>
        <p className="nota">Esta fuente no publica {nombre} para la estación.</p>
      </section>
    );
  }
  if (!estado.instante) {
    return (
      <section className="fuente-dato">
        <h3>{registro.fuente}</h3>
        <div className="avisos"><AvisoMarcada marcada={estado.ultima_marcada} hayValido={false} ahora={ahora} /></div>
      </section>
    );
  }
  const reciente = esReciente(estado.instante, ahora);
  // Con ICA, lo primero es la categoría: responde «¿cómo está el aire aquí?».
  // El valor horario queda debajo, como detalle. Sin ICA (meteorología, ruido o
  // un periodo sin horas suficientes) la cifra sigue siendo lo principal.
  const conCategoria = Boolean(estado.ventana_ica_horas && estado.categoria);
  return (
    <section className="fuente-dato">
      <h3>{registro.fuente}</h3>
      {conCategoria && <EscalaIca estado={estado} />}
      <p className={conCategoria ? "valor-horario" : "cifra"}>
        <strong>{formatearNumero(estado.valor_horario)}</strong>
        <span>{meta?.unidad} de {nombre}, último valor horario</span>
      </p>
      <p className="fecha-dato">
        Medido el {formatearFecha(estado.instante)},{" "}
        <span className={`antiguedad${reciente ? " reciente" : ""}`}>{antiguedad(estado.instante, ahora)}</span>
      </p>
      {/* Avisos en orden de gravedad: alerta, datos no confiables, anomalía y nota sobre la fuente. */}
      <div className="avisos">
        <AvisoAlerta alerta={alertas.find((a) => a.estacion_id === registro.id && a.parametro === parametro)} ahora={ahora} />
        <AvisoMarcada marcada={estado.ultima_marcada} hayValido ahora={ahora} />
        <AvisoAnomalias estado={estado} />
        {nota && (
          <div className="nota-fuente" role="note">
            <p><strong>Sobre esta fuente</strong> {nota[0]}</p>
            <Detalle>{nota[1]}</Detalle>
          </div>
        )}
      </div>
      {!conCategoria && <EscalaIca estado={estado} />}
      <GuiaOms estado={estado} />
      {parametro === "RUIDO" && <NormaRuido estado={estado} umbrales={umbrales} />}
      {/* Mientras llega el archivo de la gráfica no se muestra nada: la gráfica
          también espera sus datos y aparece cuando los tiene. */}
      {reciente && (
        <Suspense fallback={null}>
          <UltimasHoras registro={registro} parametro={parametro} meta={meta} ahora={ahora} />
        </Suspense>
      )}
      <button className="boton" onClick={() => onVerHistorico(registro.id)}>Ver el histórico de esta fuente</button>
    </section>
  );
}

// La dirección de la página ya lleva la estación y la variable (url.js): copiarla
// basta para compartir esta ficha. El mensaje queda en una región que el lector
// de pantalla anuncia.
function CopiarEnlace() {
  const [mensaje, setMensaje] = useState("");
  function copiar() {
    const fallo = () => setMensaje("No se pudo copiar. Copie la dirección desde la barra del navegador.");
    if (!navigator.clipboard) return fallo();
    navigator.clipboard.writeText(window.location.href).then(() => setMensaje("Enlace copiado."), fallo);
  }
  return (
    <p className="copiar-enlace">
      <button className="boton texto" type="button" onClick={copiar}>Copiar el enlace de esta estación</button>
      <span role="status">{mensaje}</span>
    </p>
  );
}

// Lo que dice la ficha cuando no hay una estación elegida, según el estado de la
// carga. Sin estaciones o con error, la ficha ofrece volver a cargar: un estado
// vacío no debe ser un callejón sin salida.
const FICHA_VACIA = {
  cargando: ["Cargando las estaciones…", "En unos segundos aparecen en el mapa y en la lista."],
  vacio: ["No hay estaciones para mostrar", "La plataforma no recibió estaciones de ninguna fuente. Puede que la "
    + "ingesta esté en curso: vuelva a cargar en unos minutos.", "Volver a cargar"],
  error: ["No se pudieron cargar las estaciones", "Sin estaciones no hay mapa ni lista. Vuelva a intentarlo en un "
    + "momento.", "Volver a cargar"],
  listo: ["Elija una estación", "Toque una estación en el mapa o búsquela en la lista para ver su último dato y, en los "
    + "contaminantes, su categoría del ICA."],
};

export default function Ficha({ grupo, parametro, meta, zonas, onVerHistorico, ahora, alertas = [], umbrales,
                                carga = "listo", onReintentar }) {
  if (!grupo) {
    const [titulo, texto, accion] = FICHA_VACIA[carga];
    return (
      <section className="ficha vacia" aria-busy={carga === "cargando"}>
        <h2>{titulo}</h2>
        <p className={carga === "cargando" ? "cargando" : undefined}>{texto}</p>
        {accion && onReintentar && (
          <button className="boton" type="button" onClick={onReintentar}>{accion}</button>
        )}
      </section>
    );
  }
  return (
    // Sin aria-live: al elegir una estación el foco pasa al nombre (App.jsx), y
    // así el lector no vuelve a leer toda la ficha con cada actualización.
    // La clave hace que la ficha se vuelva a montar al cambiar de estación (con su
    // fundido de entrada) y no cuando solo cambia la variable.
    <section className="ficha" aria-labelledby="titulo-ficha" key={grupo.id}>
      <h2 id="titulo-ficha" tabIndex={-1}>{grupo.nombre}</h2>
      {zonas && zonaDe(zonas, grupo.coordenadas) && <p className="zona">{zonaDe(zonas, grupo.coordenadas)}</p>}
      <CopiarEnlace />
      {grupo.registros.length > 1 && (
        <p className="nota">Dos fuentes publican datos de esta estación. Se muestran por separado.</p>
      )}
      {grupo.registros.map((r) => (
        <DatoFuente key={r.id} registro={r} parametro={parametro} meta={meta} onVerHistorico={onVerHistorico}
                    ahora={ahora} alertas={alertas} umbrales={umbrales} />
      ))}
    </section>
  );
}
