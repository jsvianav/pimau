import { antiguedad, formatearFecha, formatearNumero, HORAS_MINIMAS_ICA, PARAMETROS, textoSobre } from "../util.js";

function Categoria({ estado }) {
  if (!estado.categoria) {
    return (
      <p className="sin-ica">
        Sin ICA: ningún periodo de 24 horas de esta serie tiene las {HORAS_MINIMAS_ICA} horas válidas que se
        requieren para calcularlo.
      </p>
    );
  }
  return (
    <>
      <p className="categoria" style={{ background: estado.color, color: textoSobre(estado.color) }}>
        {estado.categoria} <span>(ICA {estado.ica})</span>
      </p>
      <p className="nota">
        Promedio de 24 horas de {formatearNumero(estado.promedio_24h)} µg/m³ ({estado.horas_validas_24h} horas válidas), periodo
        que termina el {formatearFecha(estado.instante_ica)}.
      </p>
    </>
  );
}

function DatoFuente({ registro, parametro, onVerHistorico }) {
  const estado = registro.parametros[parametro];
  const nombre = PARAMETROS[parametro];
  if (!estado) {
    return (
      <section className="fuente-dato">
        <h3>{registro.fuente}</h3>
        <p>Esta fuente no publica {nombre} para la estación.</p>
      </section>
    );
  }
  const superaOms = estado.promedio_24h != null && estado.guia_oms_24h != null && estado.promedio_24h > estado.guia_oms_24h;
  return (
    <section className="fuente-dato">
      <h3>{registro.fuente}</h3>
      <dl>
        <dt>Último valor horario</dt>
        <dd>{formatearNumero(estado.valor_horario)} µg/m³</dd>
        <dt>Fecha del dato</dt>
        <dd>{formatearFecha(estado.instante)} <span className="antiguedad">({antiguedad(estado.instante)})</span></dd>
      </dl>
      <Categoria estado={estado} />
      {estado.guia_oms_24h != null && (
        <p className="oms">
          Guía OMS 2021 (24 h): {estado.guia_oms_24h} µg/m³.{" "}
          {estado.promedio_24h != null && (superaOms ? "Ese promedio la supera." : "Ese promedio no la supera.")}
        </p>
      )}
      <button className="boton" onClick={() => onVerHistorico(registro.id)}>Ver histórico de esta fuente</button>
    </section>
  );
}

export default function Ficha({ grupo, parametro, onVerHistorico }) {
  if (!grupo) {
    return (
      <section className="ficha vacia">
        <h2>Estación</h2>
        <p>Seleccione una estación en el mapa o en la lista para ver su último estado registrado.</p>
      </section>
    );
  }
  return (
    <section className="ficha" aria-live="polite">
      <h2>{grupo.nombre}</h2>
      <p className="nota">
        {grupo.registros.length > 1
          ? `Esta estación aparece en ${grupo.registros.length} fuentes. Se muestran por separado.`
          : "Datos de una fuente."}
      </p>
      {grupo.registros.map((r) => (
        <DatoFuente key={r.id} registro={r} parametro={parametro} onVerHistorico={onVerHistorico} />
      ))}
    </section>
  );
}
