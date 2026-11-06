// Página «Acerca de» (plan de funcionalidades, F2 y F3): de dónde salen los
// datos, cómo leerlos, qué límites tienen y cómo usarlos desde la API. Los
// visores de referencia (SIATA, IBOCA, AirNow) explican esto en su propia página.
const FUENTES = [
  ["SATIC (red OAC22)", "Alcaldía de Cali",
   "16 estaciones, sobre todo del sur de la ciudad: material particulado, temperatura, humedad, viento y ruido. Es la fuente de los datos recientes; se consulta cada hora."],
  ["Portal de Datos Abiertos de Cali", "DAGMA",
   "Las nueve estaciones de la red de la ciudad, con series horarias de 2010 a 2020. Fuente histórica."],
  ["datos.gov.co", "IDEAM",
   "Las mediciones que las autoridades ambientales reportan al SISAIRE, con datos de Cali hasta diciembre de 2024. Fuente histórica."],
  ["IDESC", "Departamento Administrativo de Planeación",
   "Los límites oficiales de comunas, barrios y corregimientos."],
];

const EJEMPLOS = [
  ["/api/estaciones", "Todas las estaciones con su último dato y su categoría del ICA."],
  ["/api/estaciones/1/series?parametro=PM25&desde=2026-10-01&hasta=2026-10-31&agregacion=hora",
   "La serie horaria de una estación en un periodo. Cambie el número por el de la estación."],
  ["/api/estaciones/1/series.csv?parametro=PM25&desde=2026-10-01&hasta=2026-10-31&agregacion=dia",
   "La misma consulta en CSV, con promedios diarios."],
];

export default function Acerca() {
  return (
    <article className="acerca">
      <h2>Acerca de PIMAU</h2>
      <p>
        PIMAU reúne en un solo lugar los datos abiertos de calidad del aire, meteorología y ruido de Santiago de Cali, que
        hoy publican varias entidades por separado, cada una con su formato. Los muestra en un mapa, guarda el histórico y
        señala qué tan confiable es cada dato.
      </p>

      <h3>De dónde salen los datos</h3>
      <ul>
        {FUENTES.map(([fuente, quien, aporte]) => (
          <li key={fuente}><strong>{fuente}</strong> ({quien}). {aporte}</li>
        ))}
      </ul>
      <p>
        Cada dato conserva su fuente y la fecha en que se cargó. Si una fuente deja de responder, la plataforma sigue
        mostrando lo último que recibió, con su fecha.
      </p>

      <h3>Cómo leer el mapa</h3>
      <ul>
        <li>
          <strong>Índice de Calidad del Aire (ICA).</strong> El color de cada contaminante sigue la Resolución 2254 de 2017
          del Ministerio de Ambiente. Para el material particulado se calcula con el promedio de las últimas 24 horas, y solo
          si hay al menos 18 horas con dato; si no, la estación sale en gris.
        </li>
        <li>
          <strong>Ruido.</strong> Se mide en decibeles A y se compara con los límites de la Resolución 627 de 2006 para zonas
          residenciales, de día y de noche.
        </li>
        <li>
          <strong>Datos faltantes y dudosos.</strong> Ningún dato se borra ni se rellena. Cada medición lleva una marca: válida,
          faltante, fuera del rango físico posible o sospechosa (seis horas seguidas o más con el mismo valor, típico de un
          sensor detenido).
        </li>
        <li>
          <strong>Valores anómalos.</strong> Cada hora, un modelo de aprendizaje automático (Isolation Forest) revisa los
          datos nuevos y señala los que se salen del comportamiento habitual de la estación. Un valor anómalo puede ser una
          falla del sensor o un evento real, como una quema; se señala, pero no se modifica.
        </li>
        <li>
          <strong>Alertas.</strong> Aparecen cuando una medición de las últimas tres horas iguala o supera el umbral que
          configuró el administrador.
        </li>
      </ul>

      <h3>Limitaciones</h3>
      <ul>
        <li>No es una fuente oficial. Para decisiones de salud pública, consulte al DAGMA y a la autoridad ambiental.</li>
        <li>Los datos recientes vienen de SATIC, cuyas estaciones están sobre todo en el sur de la ciudad. El resto de Cali
          solo tiene histórico.</li>
        <li>Algunas lecturas de SATIC tienen rasgos de sensores de bajo costo (por ejemplo, PM10 casi igual al PM2.5), menos
          precisos que los equipos de referencia del DAGMA y del IDEAM.</li>
        <li>No es tiempo real: cada dato llega con el retraso de su fuente.</li>
      </ul>

      <h3>Usar los datos</h3>
      <p>
        Los datos se pueden consultar y descargar sin registro desde la{" "}
        <a href="/api/docs">documentación interactiva de la API</a>. Algunos ejemplos:
      </p>
      <dl className="ejemplos-api">
        {EJEMPLOS.map(([ruta, texto]) => (
          <div key={ruta}>
            <dt><a href={ruta} target="_blank" rel="noreferrer"><code>{ruta}</code></a></dt>
            <dd>{texto}</dd>
          </div>
        ))}
      </dl>
      <p className="nota">
        Las fechas van en UTC (ISO 8601) y las coordenadas en latitud y longitud (EPSG:4326). Al reutilizar los datos, cite
        la fuente original de cada medición.
      </p>

      <h3>Quién lo hizo</h3>
      <p>
        Trabajo de grado de John Sebastian Viana Vargas, del programa de Ingeniería de Sistemas de la Universidad de San
        Buenaventura Cali.
      </p>
    </article>
  );
}
