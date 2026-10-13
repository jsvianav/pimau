import { antiguedad, formatearFecha, formatearNumero, nombreCorto, zonaDe } from "../util.js";

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
          <span key={color} className={i === indice ? "actual" : undefined} style={{ background: color }} />
        ))}
        <span className="escala-marcador" style={{ left: `${porcentaje}%` }} />
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

function DatoFuente({ registro, parametro, meta, onVerHistorico }) {
  const estado = registro.parametros[parametro];
  const nombre = nombreCorto(parametro);
  if (!estado) {
    return (
      <section className="fuente-dato">
        <h3>{registro.fuente}</h3>
        <p className="nota">Esta fuente no publica {nombre} para la estación.</p>
      </section>
    );
  }
  return (
    <section className="fuente-dato">
      <h3>{registro.fuente}</h3>
      <p className="cifra">
        <strong>{formatearNumero(estado.valor_horario)}</strong>
        <span>{meta?.unidad} de {nombre}, último valor horario</span>
      </p>
      <p className="fecha-dato">
        Medido el {formatearFecha(estado.instante)}, <span className="antiguedad">{antiguedad(estado.instante)}</span>
      </p>
      <EscalaIca estado={estado} />
      <GuiaOms estado={estado} />
      <button className="boton" onClick={() => onVerHistorico(registro.id)}>Ver el histórico de esta fuente</button>
    </section>
  );
}

export default function Ficha({ grupo, parametro, meta, zonas, onVerHistorico }) {
  if (!grupo) {
    return (
      <section className="ficha vacia">
        <h2>Elija una estación</h2>
        <p>Toque una estación en el mapa o búsquela en la lista para ver su último dato y, en los contaminantes, su
          categoría del ICA.</p>
      </section>
    );
  }
  return (
    <section className="ficha" aria-live="polite">
      <h2>{grupo.nombre}</h2>
      {zonas && zonaDe(zonas, grupo.coordenadas) && <p className="zona">{zonaDe(zonas, grupo.coordenadas)}</p>}
      {grupo.registros.length > 1 && (
        <p className="nota">Dos fuentes publican datos de esta estación. Se muestran por separado.</p>
      )}
      {grupo.registros.map((r) => (
        <DatoFuente key={r.id} registro={r} parametro={parametro} meta={meta} onVerHistorico={onVerHistorico} />
      ))}
    </section>
  );
}
