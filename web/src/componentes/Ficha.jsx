import { antiguedad, formatearFecha, formatearNumero, HORAS_MINIMAS_ICA, PARAMETROS } from "../util.js";

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
  if (!estado.categoria) {
    return (
      <p className="sin-ica">
        No se puede calcular el ICA: ningún periodo de 24 horas de esta serie tiene las {HORAS_MINIMAS_ICA} horas
        válidas que exige el cálculo.
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
          <span key={color} className={i === indice ? "actual" : undefined} style={{ background: color }} />
        ))}
        <span className="escala-marcador" style={{ left: `${porcentaje}%` }} />
      </div>
      <div className="escala-extremos" aria-hidden="true"><span>Buena</span><span>Peligrosa</span></div>
      <p className="escala-detalle">
        Promedio de {formatearNumero(estado.promedio_24h)} µg/m³ en las 24 horas que terminan el{" "}
        {formatearFecha(estado.instante_ica)}, con {estado.horas_validas_24h} horas válidas.
      </p>
    </div>
  );
}

function DatoFuente({ registro, parametro, onVerHistorico }) {
  const estado = registro.parametros[parametro];
  if (!estado) {
    return (
      <section className="fuente-dato">
        <h3>{registro.fuente}</h3>
        <p className="nota">Esta fuente no publica {PARAMETROS[parametro]} para la estación.</p>
      </section>
    );
  }
  const superaOms = estado.promedio_24h != null && estado.guia_oms_24h != null && estado.promedio_24h > estado.guia_oms_24h;
  return (
    <section className="fuente-dato">
      <h3>{registro.fuente}</h3>
      <p className="cifra">
        <strong>{formatearNumero(estado.valor_horario)}</strong>
        <span>µg/m³ de {PARAMETROS[parametro]}, último valor horario</span>
      </p>
      <p className="fecha-dato">
        Medido el {formatearFecha(estado.instante)}, <span className="antiguedad">{antiguedad(estado.instante)}</span>
      </p>
      <EscalaIca estado={estado} />
      {estado.guia_oms_24h != null && estado.promedio_24h != null && (
        <p className="oms">
          La guía de la OMS recomienda no superar {estado.guia_oms_24h} µg/m³ en 24 horas. Ese promedio{" "}
          {superaOms ? "la supera" : "está por debajo"}.
        </p>
      )}
      <button className="boton" onClick={() => onVerHistorico(registro.id)}>Ver el histórico de esta fuente</button>
    </section>
  );
}

export default function Ficha({ grupo, parametro, onVerHistorico }) {
  if (!grupo) {
    return (
      <section className="ficha vacia">
        <h2>Elija una estación</h2>
        <p>Toque una estación en el mapa o búsquela en la lista para ver su último dato y su categoría del ICA.</p>
      </section>
    );
  }
  return (
    <section className="ficha" aria-live="polite">
      <h2>{grupo.nombre}</h2>
      {grupo.registros.length > 1 && (
        <p className="nota">Dos fuentes publican datos de esta estación. Se muestran por separado.</p>
      )}
      {grupo.registros.map((r) => (
        <DatoFuente key={r.id} registro={r} parametro={parametro} onVerHistorico={onVerHistorico} />
      ))}
    </section>
  );
}
