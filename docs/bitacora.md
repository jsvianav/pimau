# Bitácora del proyecto PIMAU

Registro cronológico del trabajo: qué se hizo, qué se decidió y por qué, qué
problemas aparecieron y qué queda pendiente. Cada entrada sirve de evidencia
para el Capítulo 3 (ejecución de los incrementos) y el Capítulo 4.

**Convención:** una entrada por sesión de trabajo, la más reciente al final.
Las decisiones que cambian la arquitectura se registran además como ADR en el
documento del trabajo de grado.

---

## 2026-10-06 — Preparación del documento

- Se instaló BasicTeX y los paquetes necesarios para compilar el documento
  (XeLaTeX, biber, minted).
- Se incorporaron las imágenes del modelo C4 y del modelo de datos, y las
  referencias del Capítulo 3.

## 2026-10-09 — Revisión del marco de referencia y del Capítulo 3

- Se reescribió el Capítulo 2 según las observaciones del director: marco
  teórico en secuencia lógica, marco conceptual separado y 21 antecedentes
  académicos con DOI verificado en Crossref.
- Se identificó la IDESC como fuente de las capas de comunas y barrios
  (servicio WFS, Acuerdo 0636 de 2026). Esto resolvió el pendiente de RF-09.
- Se completaron los anexos A (SRS) y B (diccionario de datos).

## 2026-10-09 — Revisión de SATIC

- Se revisó el geoportal de SATIC (satic.cali.gov.co) después de aceptar sus
  términos y condiciones.
- **Hallazgo:** SATIC muestra 16 estaciones de calidad del aire de la red
  **OAC22**, todas en el sur de Cali (universidades, colegios, clubes y
  condominios), con datos del mismo día. Miden PM2.5, PM10, ruido, temperatura,
  humedad y, en algunas, dirección del viento. La Universidad de San
  Buenaventura aloja una de ellas (código USB).
- **Advertencias:** la unidad de PM2.5 aparece como "(CC)" y no como µg/m³, y
  los valores observados fueron bajos (entre 2 y 5 en la estación de la
  Universidad Santiago de Cali). Hay que confirmar el tipo de sensor y si los
  datos se calibran.
- El servicio interno (`satic.cali.gov.co:9090/api`) no está documentado y no
  respondió a consultas directas.
- **Decisión:** no usar SATIC hasta tener autorización. Se registró como fuente
  inactiva en la base de datos y se redactó la solicitud de acceso
  (`docs/gestion/solicitud_acceso_datos_satic.md`).

## 2026-10-09 — Inicio del MVP: incremento 1 (integración de datos)

**Objetivo del incremento:** base de datos con mediciones normalizadas de al
menos dos fuentes, con banderas de calidad y procedencia (RF-01 a RF-04).

### Exploración de las fuentes

| Fuente | Acceso | Hallazgos |
| --- | --- | --- |
| IDEAM en datos.gov.co (`g4t8-zkc3`) | API Socrata | Tiene PM2.5 de **9 estaciones del DAGMA** (hasta 2022) y de **Cascajal de la CVC** (hasta el 31-12-2024). Fechas de inicio y fin del periodo, unidad `ug/m3`. |
| Datos Abiertos de Cali (DAGMA) | API CKAN, datastore | Un recurso por estación con una columna por contaminante. Los nombres de columna cambian (`PM2,5` frente a `PM2.5`), hay dos formatos de fecha (ISO y `MM/DD/AAAA HH:MM`), algunas fechas vienen como número de serie de Excel (`41646`) y los faltantes se marcan con `ND`. Base Aérea no está en el datastore. |
| IDESC | OGC WFS | 22 comunas y 342 barrios y sectores. Publica en EPSG:6249, pero GeoServer los entrega en EPSG:4326 si se piden así. La capa de estaciones del DAGMA trae latitud y longitud en 0,0 para La Ermita, aunque su geometría es correcta. |

**Corrección para el documento:** el Capítulo 3 dice que el PM2.5 solo se mide
en tres estaciones. El conjunto del IDEAM muestra PM2.5 en nueve estaciones del
DAGMA hasta 2022. Hay que actualizar la sección de disponibilidad de datos y
RF-12.

### Decisiones

- **Estructura del repositorio:** un solo paquete Python (`backend/pimau`) con
  la base de datos y la ingesta. La API se agrega en el incremento 2 dentro del
  mismo paquete y corre como otro proceso, como indica el ADR-01.
- **Instante de la medición:** se usa el final del periodo de promediación. El
  IDEAM lo entrega como `med_fecha_final`; en el portal de Cali las series
  empiezan a la 01:00, lo que indica que la hora marca el final del periodo.
- **Zona horaria:** las fuentes publican en hora de Colombia sin zona. Se
  interpretan como `America/Bogota` y se guardan en UTC.
- **Rangos físicos (RF-03):** PM2.5 entre 0 y 1000 µg/m³ y PM10 entre 0 y
  2000 µg/m³. Fuera de esos rangos el valor se guarda con la bandera
  `fuera_de_rango`.
- **Filas con fecha ilegible:** no se pueden guardar como medición. Se
  descartan y la ejecución las reporta como advertencia, para que una sola
  fila mala no detenga la fuente.
- **Repetición de la ingesta:** `ON CONFLICT DO NOTHING` sobre (estación,
  parámetro, instante). Una carga repetida no duplica datos y conserva la
  ejecución original como procedencia.
- **Transformación de coordenadas:** se piden las capas de la IDESC en
  EPSG:4326 y el conector rechaza cualquier respuesta en otro sistema.
- **Puntos de corte del ICA:** no se cargaron todavía. La Tabla 6 de la
  Resolución 2254 de 2017 solo aparece como imagen en las fuentes consultadas
  y no se quiso cargarla de memoria. Se verificará contra el texto oficial
  antes del incremento 2. Las guías de la OMS 2021 sí se cargaron.
- **Mismas estaciones en dos fuentes:** las estaciones del DAGMA aparecen en el
  portal de Cali y en el IDEAM con códigos distintos. Por ahora se guardan
  como estaciones distintas, cada una con su fuente. Relacionarlas queda como
  tarea del incremento 2.

### Problemas encontrados y cómo se resolvieron

| Problema | Causa | Solución |
| --- | --- | --- |
| La migración inicial fallaba con "índice ya existe". | GeoAlchemy2 crea el índice espacial al crear la tabla y la migración autogenerada lo creaba otra vez. | Se quitaron los `create_index` duplicados. |
| El conteo de registros cargados daba -1. | Con psycopg 3, `rowcount` no informa las filas de un INSERT de varias filas. | Se cuenta con `RETURNING`. Lo detectó una prueba de integración. |
| El IDEAM agotaba el tiempo de espera. | Páginas de 50 000 filas. | Páginas de 10 000 filas y reintentos con espera creciente. |
| El portal de Cali fallaba con la fecha `41646`. | Fecha guardada como número de serie de Excel. | Se agregó ese formato a la normalización, con prueba. |
| Se descartaron 59 156 filas del portal de Cali por fecha ilegible. | En Cañaveralejo y La Ermita el número de serie de Excel trae coma decimal (`41646,04167`). | Se aceptó la coma decimal y se recargó la fuente. Se recuperaron las 59 156 filas y no quedó ninguna descartada. |

En la primera ejecución real fallaron el IDEAM y el portal de Cali, pero la
IDESC cargó sus 364 capas. Esto confirmó en datos reales el comportamiento del
escenario 6: una fuente caída no afecta a las demás y su error queda
registrado.

### Resultado de la primera carga completa

| Fuente | Parámetro | Estaciones | Mediciones | Faltantes | Fuera de rango | Periodo |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Datos Abiertos de Cali | PM10 | 7 | 432 323 | 25,3 % | 0 | 2010-01-28 a 2020-08-01 |
| Datos Abiertos de Cali | PM2.5 | 3 | 155 511 | 46,8 % | 0 | 2013-03-01 a 2020-01-01 |
| IDEAM (datos.gov.co) | PM10 | 8 | 91 920 | 0 % | 0 | 2020-01-01 a 2025-01-01 |
| IDEAM (datos.gov.co) | PM2.5 | 10 | 103 687 | 0 % | 0 | 2020-01-01 a 2025-01-01 |

Total: 783 441 mediciones, 364 capas territoriales (22 comunas y 342 barrios
y sectores). La carga completa tomó cerca de 8 minutos.

**Hallazgos de la carga:**

- **El IDEAM no publica las horas sin dato.** Su 0 % de faltantes no significa
  que la serie esté completa, sino que las horas sin medición simplemente no
  aparecen. En cambio, el portal de Cali sí publica esas horas con `ND`. Para
  cumplir RF-03 de forma homogénea hay que generar los faltantes implícitos a
  partir de la frecuencia esperada (horaria). Queda como decisión del
  incremento 2.
- **Los datos del portal de Cali llegan hasta 2020**, no hasta 2021 como dice
  el Capítulo 3. Las dos fuentes se complementan: el portal cubre de 2010 a
  2020 y el IDEAM de 2020 a 2025.
- **Casi la mitad de las horas de PM2.5 del portal de Cali faltan** (46,8 %).
  Es un dato importante para el pronóstico del Semestre 8.
- **Pance y Cascajal quedan fuera de las 22 comunas** porque están en la zona
  rural del sur. Hay que cargar también la capa de corregimientos de la IDESC
  para ubicarlas en el territorio.

### Pruebas

- 33 pruebas automáticas que pasan: normalización, conectores con respuestas
  simuladas y pruebas de integración contra PostGIS real (no duplicar, aislar
  fallas, ingesta incremental). Se ejecutan en GitHub Actions en cada cambio.

### Pendientes

- [ ] Enviar la solicitud de acceso a SATIC.
- [ ] Crear la clave gratuita de OpenAQ y verificar si hay estaciones de Cali.
- [x] Verificar los puntos de corte del ICA contra la Resolución 2254 de 2017 (ver entrada siguiente).
- [x] Cargar Base Aérea desde el archivo CSV del portal de Cali.
- [x] Generar los faltantes implícitos del IDEAM según la frecuencia horaria.
- [x] Cargar la capa de corregimientos de la IDESC.
- [ ] Actualizar el Capítulo 3 con los hallazgos de esta entrada.
- [ ] Incremento 2: API de consulta y visor.

## 2026-10-09 — Cierre de los pendientes del incremento 1

### Puntos de corte del ICA

Se leyó la Tabla 6 de la Resolución 2254 de 2017 en la imagen que acompaña el
texto oficial de la norma (Secretaría Jurídica Distrital de Bogotá, norma
82634) y se cargaron en la migración `0003_puntos_corte_ica`.

| Categoría | Color | PM10 (µg/m³, 24 h) | PM2.5 (µg/m³, 24 h) |
| --- | --- | --- | --- |
| Buena | Verde | 0–54 | 0–12 |
| Aceptable | Amarillo | 55–154 | 13–37 |
| Dañina a la salud de grupos sensibles | Naranja | 155–254 | 38–55 |
| Dañina a la salud | Rojo | 255–354 | 56–150 |
| Muy dañina a la salud | Púrpura | 355–424 | 151–250 |
| Peligrosa | Marrón | 425–604 | 251–500 |

La norma nombra los colores, pero no da códigos. Los códigos hexadecimales
son una elección de diseño de la plataforma.

**Pregunta abierta para el incremento 2:** los límites son enteros y las
mediciones pueden tener decimales (por ejemplo, 12,5 µg/m³ queda entre
"Buena" y "Aceptable"). Hay que definir la regla de clasificación
(redondeo o intervalos continuos) y confirmarla con la norma o con el
protocolo del IDEAM.

### Fechas invertidas en Cañaveralejo y La Ermita

**Hallazgo importante.** En esas dos estaciones, todas las fechas con barra
tenían el día mayor que 12, y el resto venía como número de serie de Excel.
Al revisar el orden de las filas se confirmó un defecto típico de Excel: las
fechas mes/día con día menor o igual a 12 se leyeron como día/mes y se
convirtieron en números con el día y el mes cambiados. Por ejemplo, después
de `06/30/2014 23:00` viene `41646`, que Excel leyó como 7 de enero de 2014,
pero corresponde al 1 de julio de 2014.

El defecto solo afecta el periodo de 2014 a 2018. Desde 2019 los números de
serie son correctos (`43478` es el 13 de enero de 2019). Por eso no sirve una
regla fija por estación.

**Decisión.** Cuando una fecha de Excel admite dos lecturas (día menor o igual
a 12 y distinto del mes), se elige la que queda más cerca de una hora después
de la fila anterior, porque las series son horarias y vienen ordenadas.

**Verificación.** Con la regla aplicada, Cañaveralejo, La Ermita y Base Aérea
no tienen ningún salto hacia atrás en el tiempo, y solo queda un hueco de dos
horas en Cañaveralejo, que es un faltante real.

**Corrección de datos.** Se eliminaron las 114 109 mediciones de esas dos
estaciones cargadas con fechas erróneas y se recargaron. La recarga produjo
exactamente 114 110 filas (las 114 109 originales y el único faltante real),
sin ninguna fila descartada.

### Base Aérea

Se carga desde el archivo CSV del portal. El archivo usa `;` como separador y
tiene marca BOM. Hasta 2018 las fechas son ISO, y en 2019 son día/mes/año con
la hora `24:00` para la medianoche. La normalización ahora exige declarar el
orden de las fechas con barras para cada recurso, porque una fecha como
`05/06/2019` es ambigua.

### Faltantes implícitos

Después de cargar cada fuente horaria, la ingesta genera como faltantes las
horas que la fuente no publicó, entre la primera y la última medición de cada
serie. La operación es idempotente.

Esto cambió por completo la lectura del IDEAM. Su 0 % de faltantes pasó a
**57 %**, porque esa fuente simplemente no publicaba las horas sin dato.

### Corregimientos

Se cargó la capa `dapm:pdt_dpa_corregimientos` (15 corregimientos). Pance
quedó en el corregimiento de Pance y Cascajal en el de El Hormiguero. Todas
las estaciones quedan ubicadas en una comuna o en un corregimiento.

### Estado de la base después de esta sesión

| Fuente | Parámetro | Estaciones | Mediciones | Faltantes | Periodo |
| --- | --- | ---: | ---: | ---: | --- |
| Datos Abiertos de Cali | PM10 | 7 | 432 324 | 25,3 % | 2010-01-28 a 2020-08-01 |
| Datos Abiertos de Cali | PM2.5 | 4 | 215 249 | 43,3 % | 2013-03-01 a 2020-01-01 |
| IDEAM (datos.gov.co) | PM10 | 8 | 212 724 | 56,8 % | 2020-01-01 a 2025-01-01 |
| IDEAM (datos.gov.co) | PM2.5 | 10 | 240 709 | 56,9 % | 2020-01-01 a 2025-01-01 |

Total: 1 101 006 mediciones, ninguna fuera de rango. Capas: 22 comunas, 342
barrios y sectores y 15 corregimientos. Umbrales: 12 puntos de corte del ICA
y 4 valores guía de la OMS.

Pruebas: 39, todas pasan.

### Pendientes

- [ ] Enviar la solicitud de acceso a SATIC.
- [ ] Crear la clave gratuita de OpenAQ y verificar si hay estaciones de Cali.
- [x] Definir la regla de clasificación del ICA para valores con decimales.
- [ ] Relacionar las estaciones del DAGMA que aparecen en dos fuentes.
- [x] Agregar la prueba automática de capas (ADR-01).
- [ ] Actualizar el Capítulo 3 con los hallazgos de la bitácora.
- [ ] Incremento 2: API de consulta y visor.

## 2026-10-09 — Incremento 2: API de consulta y visor

**Objetivo del incremento:** API y visor con el mapa, las series y las
descargas (RF-05 a RF-09).

### Qué se construyó

- **API de consulta** (`backend/pimau/api`, FastAPI), capa de servicios del
  ADR-01. Solo lee la base de datos.
  - `/api/estaciones`: GeoJSON con la última medición válida de cada estación,
    el ICA del último periodo de 24 horas representativo y el valor guía de la
    OMS (RF-05 y RF-07).
  - `/api/estaciones/{id}/series`: serie horaria (hasta 93 días) o promedio
    diario (RF-06).
  - `/api/estaciones/{id}/series.csv`: descarga con estación, fuente, unidad,
    instante, valor y bandera (RF-08).
  - `/api/capas/{comuna|barrio|corregimiento}`: capas de la IDESC (RF-09).
  - Documentación OpenAPI en `/api/docs` (RF-08).
  - Caché en memoria de 10 minutos y límite de 120 solicitudes por minuto por
    IP (ADR-04).
- **Visor** (`web/`, React y MapLibre GL JS), capa de presentación. Sigue los
  bocetos F1 y F2 del Capítulo 3: mapa con estaciones coloreadas por ICA,
  leyenda con nombres de categoría, capas de comunas, corregimientos y
  barrios, ficha por fuente, lista de estaciones como alternativa accesible al
  mapa e histórico con gráfica, faltantes visibles y descarga en CSV.
- **Contenedores:** `api` (uvicorn) y `web` (nginx, que sirve el visor y
  reenvía `/api` a la API).
- **Mapa base:** OpenFreeMap (datos de OpenStreetMap), gratuito y sin clave,
  como exige la restricción económica.
- **Prueba de arquitectura:** una prueba falla si la API, la ingesta o la
  analítica importan código de otra capa. Así la regla del ADR-01 queda
  verificada en cada cambio.

### Decisiones

- **Cálculo del ICA.** Se verificó en el texto oficial de la Resolución 2254
  (artículo 21 y su parágrafo 3) que el ICA se obtiene por interpolación entre
  los puntos de corte y que, para el reporte en tiempo real, se usa el promedio
  móvil del tiempo de exposición, que para PM2.5 y PM10 es de 24 horas.
- **Decimales.** Los puntos de corte son enteros. La concentración se trunca al
  entero antes de clasificarla, así que 12,5 µg/m³ queda en "Buena" (0–12).
  Esta regla es una decisión del proyecto: la norma no la define.
- **Representatividad.** Un promedio de 24 horas se usa para el ICA solo si
  tiene al menos 18 horas válidas (75 %). Es una decisión del proyecto y es
  configurable.
- **Último ICA y no último dato.** Al final de muchas series hay muy pocos
  datos, así que el ICA de las 24 horas que terminan en el último dato casi
  nunca es representativo. La API devuelve por separado la última medición y
  el ICA del último periodo de 24 horas representativo, cada uno con su
  fecha, y el visor muestra ambos.
- **Misma estación en dos fuentes.** El visor agrupa las estaciones por nombre
  normalizado y muestra cada fuente por separado en la ficha. Se descartó
  agrupar por distancia por el hallazgo siguiente.

### Hallazgo: coordenadas del IDEAM

El IDEAM publica la estación **Era Obrero con las coordenadas exactas de Base
Aérea** (0 m entre ellas), y su Base Aérea queda a 470 m. La IDESC ubica
ERA-Obrero a 1,7 km, en el barrio El Obrero (comuna 9), lo que coincide con su
nombre. Se toman como oficiales las coordenadas de la IDESC. Conviene
reportarlo al IDEAM y mencionarlo en el Capítulo 3 como ejemplo de por qué la
plataforma registra la procedencia de cada dato.

### Verificación

- Backend: 68 pruebas pasan (cálculo del ICA en los límites de cada categoría,
  API contra PostGIS real, arquitectura de capas). Visor: 8 pruebas pasan.
- Tiempos medidos sobre 1,1 millones de mediciones: `/api/estaciones` tarda
  cerca de 1,7 s sin caché y 2 ms con caché; una serie diaria de cinco años,
  22 ms. Cumplen el escenario 2 (consultas de 1,5 s o menos con caché y carga
  inicial de 3 s o menos).
- Se probó en el navegador: mapa, ficha con dos fuentes, histórico con
  huecos, descarga en CSV y vista de celular.

### Pendientes

- [ ] Reportar al IDEAM la inconsistencia de coordenadas de Era Obrero.
- [ ] Guardar en la base la relación entre estaciones de distintas fuentes,
      en lugar de resolverla en el visor.
- [ ] Revisión de accesibilidad con una herramienta automática (RNF-07).
- [ ] Medición formal de tiempos de carga del visor (escenario 2).
- [ ] Incremento 3: panel de administración (RF-10 y RF-11).
- [ ] Actualizar el Capítulo 3 con los hallazgos de la bitácora.

## 2026-10-09 — Rediseño del visor

Se rediseñó la interfaz con un sistema de diseño propio, en lugar de la
apariencia genérica de la primera versión.

- **Color.** La interfaz usa tonos apagados inspirados en los Farallones
  (verde pizarra sobre un fondo neblina) para que los colores del ICA, que fija
  la Resolución 2254, sean lo único que resalte en el mapa y en la ficha.
- **Tipografía.** Public Sans para el texto (diseñada para información de
  servicio público, muy legible) y Bricolage Grotesque para títulos y cifras.
  Se probó Atkinson Hyperlegible, pero su cero tachado se leía raro en fechas y
  cifras en español. Las fuentes se sirven desde el propio visor, sin depender
  de un servicio externo.
- **Escala del ICA en la ficha.** Muestra las seis categorías con un marcador
  en el valor de la estación, para que la norma se vea y no solo se lea.
- **Contexto de los datos.** Una franja bajo el encabezado indica hasta qué
  fecha llegan los datos abiertos de Cali.
- **Gráfica del histórico.** Se siguió la guía de visualización de datos: el
  color de la serie se validó con un script de contraste y croma, las líneas de
  referencia van en tinta neutra (sin reutilizar los colores del ICA) y su
  explicación está en una clave bajo la gráfica, y hay una vista en tabla como
  alternativa accesible.
- **Detalles de uso.** El mapa ocupa la ventana y el panel hace scroll por su
  cuenta. Al elegir una estación, la ficha se muestra desde el inicio. Se
  respeta la preferencia de movimiento reducido del sistema.

**Hallazgo en los datos:** el pico de PM2.5 de cerca de 200 µg/m³ en Base
Aérea la noche del 31 de diciembre de 2019 coincide con la pólvora de Año
Nuevo. Es un buen caso para la detección de anomalías del Semestre 8, porque es
un evento real y no un error del sensor.

## 2026-10-10 — Cambio de alcance: meteorología y otros contaminantes

### Cambio de alcance aprobado

**Decisión del estudiante, 2026-10-10:** adelantar al Semestre 7 la integración
de la meteorología y de los demás contaminantes criterio, que el plan inicial
dejaba para el Semestre 8 dentro de RF-15.

- **Por qué:** las variables ya estaban en las fuentes integradas, el modelo de
  datos común las admite sin cambiar su estructura (ADR-02 y escenario 5) y
  hacen el visor más útil para los usuarios.
- **Qué cambia en los requisitos:** RF-01, RF-05 y RF-07 se amplían a todas
  esas variables. RF-15 queda limitado al ruido ambiental y la cobertura
  vegetal, que siguen en el Semestre 8.
- **Documento:** se actualizaron el Capítulo 3 (incrementos, requisitos,
  disponibilidad de datos y un párrafo del cambio de alcance) y el Anexo A.

### Variables agregadas

| Grupo | Variables | Fuentes |
| --- | --- | --- |
| Contaminantes | O₃, NO₂, SO₂, CO, H₂S | Portal de Cali; O₃ y SO₂ también del IDEAM |
| Meteorología | Temperatura, humedad, velocidad y dirección del viento, lluvia, radiación solar, presión | Portal de Cali e IDEAM (la presión solo del IDEAM) |

### Decisiones

- **ICA de cada contaminante con su tiempo de exposición.** Los puntos de corte
  se leyeron en la Tabla 6 de la Resolución 2254 de 2017 (imagen del texto
  oficial): CO y O₃ con promedio de 8 horas, SO₂ y NO₂ con 1 hora. Se exige el
  75 % de horas válidas en cada ventana (18 de 24 y 6 de 8).
- **Ozono por encima de 393 µg/m³.** La norma pide usar el ICA de 1 hora en ese
  caso. No se calcula, y el visor lo indica. En Cali ese valor es muy
  improbable.
- **H₂S** no tiene puntos de corte en la Resolución 2254, así que se muestra sin
  ICA.
- **Guías de la OMS 2021** cargadas: O₃ 100 µg/m³ (8 h), NO₂ 25 (24 h) y 10
  (anual), SO₂ 40 (24 h) y CO 4000 (24 h). El visor solo compara con la guía
  cuando su periodo coincide con el del ICA. Si no coincide, la muestra como
  referencia sin compararla.
- **Unidades.** La presión del IDEAM se convierte de mmHg a hPa. La radiación
  del IDEAM viene en Wh/m² por hora, que equivale a W/m² promedio en esa hora,
  la misma unidad del portal de Cali.
- **Temperatura y humedad del IDEAM a 2 m**, la altura estándar. Las de 10 m no
  se usan para no duplicar la variable.
- **Rangos físicos** por variable (RF-03). La humedad admite hasta 105 % porque
  los sensores marcan algo más de 100 % en saturación (se observaron valores de
  100,4 %).
- **Resumen diario por variable.** La lluvia se suma y la dirección del viento
  se promedia como ángulo (el promedio de 350° y 10° es 0°, no 180°). El resto
  se promedia.
- **Visor.** El selector agrupa contaminantes y meteorología. Las variables sin
  ICA se dibujan en un solo color con su valor junto a cada estación. En la
  gráfica, las referencias que superan el doble del máximo del periodo no se
  dibujan, para no aplastar la serie, y la meteorología usa un eje ajustado a
  los datos (la presión ronda 900 hPa).

### Error corregido

El conjunto del IDEAM incluye 33 promedios **diarios** de PM10 (duración de
1440 minutos) además de los horarios, y el conector los había cargado como si
fueran horarios. Ahora se filtran por duración y se recargó el IDEAM completo.

### Verificación

84 pruebas del backend (nuevas: conversión de unidades, filtro de promedios
diarios, ventanas del ICA, ozono sobre 393, suma de lluvia y promedio angular
del viento) y 8 del visor.

### Problemas durante la carga y su solución

| Problema | Causa | Solución |
| --- | --- | --- |
| La carga del IDEAM se volvía cada vez más lenta y terminó agotando el tiempo de espera. | datos.gov.co pagina con desplazamientos, y con desplazamientos de cientos de miles de filas cada página tardaba minutos. | Descarga por ventanas mensuales. La carga completa del IDEAM bajó a 13 minutos. |
| El 22 % de la presión del IDEAM quedó fuera de rango. | **Hallazgo de calidad de datos:** las estaciones del DAGMA declaran la presión en mmHg, pero en algunos periodos publican valores ya en hPa (cerca de 905). La conversión los multiplicaba otra vez. | Un valor de 800 o más ya está en hPa y no se convierte (en Cali la presión en mmHg ronda 670). Se corrigieron 65 936 valores guardados. Quedan 279 valores en 0 marcados como fuera de rango, que son errores del sensor. |
| `/api/estaciones` tardaba 5,7 s sin caché con 6 millones de mediciones. | El cálculo del último ICA representativo recorre todas las series. | La API calcula los indicadores al arrancar y los renueva en segundo plano cada 10 minutos (ADR-04). La primera consulta de un usuario tarda 23 ms. |

### Estado de la base después del cambio

6 130 963 mediciones de 14 variables, de 2010 a 2025. Las series de NO₂, CO
y H₂S solo vienen del portal de Cali y terminan en 2020.

### Anexos del documento

Se completaron el Anexo C (guía de instalación y manual del visor) y el Anexo
D (enlace del repositorio, bitácora e integración continua).


## 2026-10-12 — Prueba de viabilidad de la teledetección (NDVI)

**Qué se hizo.** Se consultó el catálogo público de Sentinel-2 L2A en AWS (Earth Search, sin registro) para la zona urbana de Cali (bbox -76,59 3,33 -76,46 3,50) en 2025, y se calculó el NDVI de las 12 imágenes con menos nubes, enmascarando nubes y sombras con la capa SCL.

**Resultados.** Hay 90 imágenes en 2025 (una cada cuatro días aproximadamente). Ninguna tiene menos del 10 % de nubes y solo cuatro tienen menos del 30 %. En las mejores, entre el 60 % y el 86 % de la zona urbana queda despejada. El NDVI promedio de la ciudad sale entre 0,39 y 0,52.

**Decisión.** El NDVI se calculará como un compuesto mensual por comuna con los píxeles despejados del mes, no por imagen. Al implementarlo hay que aplicar el desplazamiento de reflectancia (BOA_ADD_OFFSET) de las imágenes procesadas desde 2022, que la prueba no aplicó. Se ajustaron los capítulos 1 y 2 del documento con esta decisión.

## 2026-10-12 — Cambio de alcance: se retira la cobertura vegetal

**Decisión.** Se retira del alcance la cobertura vegetal (NDVI con imágenes Sentinel-2). RF-15 queda solo con el ruido ambiental.

**Justificación.** La prueba del mismo día mostró que el cálculo es viable, pero la nubosidad de Cali solo permite un valor mensual por comuna. Además, el estudio de Nowak, Crane y Stevens (2006) encontró que la mejora promedio de la calidad del aire por la vegetación urbana es casi siempre menor al 1 % en cada ciudad. El aporte no justifica el esfuerzo de una variable más en un proyecto de una persona.

**Cambios en el documento.** Se quitó la sección de teledetección del marco teórico, el término NDVI, el antecedente de Somvanshi y Kumari (los antecedentes académicos pasan de 21 a 20) y la entrada de cobertura vegetal de la Figura 1. El capítulo 3 explica la decisión en el párrafo del cambio de alcance.

## 2026-10-12 — Prácticas de construcción: linter, dependencias, imágenes y respaldos

**Contexto.** La revisión del documento encontró que el Capítulo 3 declaraba prácticas que el repositorio no tenía. Se implementaron.

**Qué se hizo.**
- Linter de Python con Ruff (`backend/ruff.toml`). Corrigió solo el estilo (orden de imports, sintaxis moderna, líneas largas), sin cambios de comportamiento: las 84 pruebas siguen pasando.
- Linter del visor con ESLint (`web/eslint.config.js`). Encontró cuatro usos de efectos de React que provocaban renderizados de más en el histórico y el mapa. Se reorganizó el histórico para que cambiar de estación o variable limpie la consulta en el mismo evento y para ignorar respuestas viejas si el usuario cambia de opción antes de que lleguen.
- Revisión de dependencias con `pip-audit` y `npm audit`. Encontró 7 vulnerabilidades en Starlette 0.41.3 (se subió FastAPI a 0.141.1 con Starlette 1.6.0) y una crítica de XSS en MapLibre 4.7.1, que llega al navegador del usuario (se subió a 6.11.2). También se actualizaron Vite (8.3.1) y Vitest (5.0.2). Se eligieron versiones con más de dos semanas de publicadas.
- MapLibre 6 cambió la forma de importarse y carga su proceso en segundo plano desde un archivo aparte, así que se ajustó el import y `setWorkerUrl`.
- La integración continua ahora corre los linters, las pruebas, la revisión de dependencias y la construcción de las imágenes Docker.
- Respaldo diario con el servicio `respaldo` (`scripts/respaldo.sh`): un volcado por día en `respaldos/`, se conservan 7. Se probó la restauración en una base temporal y recuperó las 6.130.963 filas.
- La base de datos ya no publica su puerto (el análisis de amenazas pide que no tenga acceso desde fuera). Apareció porque el Mac tiene otro PostgreSQL en el puerto 5432.
- nginx guardaba la dirección de la API al arrancar y respondía 502 cuando el contenedor de la API se recreaba. Ahora la vuelve a consultar en el DNS de Docker.

**Decisión sobre las solicitudes de integración.** No se protege la rama principal ni se exigen solicitudes de integración, porque el equipo es de una persona y nadie más las revisaría. Cada cambio entra a la rama principal con un mensaje que nombra lo que atiende, y la integración continua lo verifica.

## 2026-10-13 — Revisión del Capítulo 3 contra el código: esquemas de respuesta y fecha de publicación

**Contexto.** Al revisar el Capítulo 3 contra el código aparecieron dos afirmaciones que el sistema no cumplía del todo.

**Esquemas de respuesta de la API.** El texto decía que la API valida su entrada y su salida con esquemas tipados, pero las respuestas no tenían esquema. Se agregó `pimau/api/esquemas.py` (Pydantic) y cada ruta declara su `response_model`. FastAPI valida cada respuesta antes de enviarla y los esquemas aparecen en la documentación OpenAPI. Los instantes se dejaron como texto ISO 8601 para no cambiar el formato que usa el visor.

**Fecha de publicación (RF-04).** El campo `fecha_publicacion` existía pero ningún conector lo llenaba. Ahora el conector del portal de Cali guarda el `last_modified` de cada recurso en CKAN, y el del IDEAM el `rowsUpdatedAt` del conjunto en datos.gov.co. Si la fuente no responde, la ingesta sigue y la medición queda sin esa fecha. Las 6.130.963 mediciones ya cargadas se completaron con la fecha que informa cada fuente, que es anterior a la descarga y por lo tanto corresponde a la versión descargada. Portal de Cali: entre mayo de 2020 y diciembre de 2021 según la estación. IDEAM: 20 de febrero de 2026.

**Pruebas.** Tres pruebas nuevas (fecha de publicación en ambos conectores y esquemas en OpenAPI). Pasan 87.

## 2026-10-13 — Rediseño minimalista del visor

**Qué cambió.** El mapa ocupa toda la pantalla y el panel de la estación, los controles y la leyenda flotan encima como tarjetas con sombra suave. El encabezado es más delgado y las pestañas son texto subrayado. El aviso de la fecha de los datos es una etiqueta pequeña sobre el mapa.

**Mapa.** Se atenuó el mapa base de OpenFreeMap (agua y parques en tonos apagados, sin escudos de vías, rutas férreas ni el rótulo de la ciudad, que tapaba estaciones). Cada estación tiene un halo del color de su categoría del ICA y su nombre en negrita. Las comunas son líneas finas que se resaltan al pasar el puntero. Al abrir, el mapa encuadra todas las estaciones dejando libre el espacio de las tarjetas, y al elegir una estación la centra en ese espacio.

**Verificación.** Capturas con Playwright y Chrome a 1440 × 900 y a 390 × 844. El panel del navegador del editor no dibuja WebGL cuando se simula un tamaño mayor que el suyo, así que las capturas de escritorio se tomaron fuera de él. ESLint, las 8 pruebas del visor y la construcción pasan.

## 2026-10-13 — Zona de cada estación coloreada en el mapa

**Qué se hizo.** La comuna donde está cada estación se colorea con la categoría del ICA de esa estación. Pance y Cascajal están fuera de las comunas, así que para ellas se colorea su corregimiento, con un tono más suave porque los corregimientos son muy extensos. Si una zona tiene varias estaciones se usa la peor categoría, y las variables meteorológicas no colorean nada porque no tienen escala de calidad del aire.

**Cómo.** `zonasConEstacion` en `web/src/util.js` busca, con el método del rayo, el polígono de la IDESC que contiene cada estación. Tiene dos pruebas nuevas (polígonos con hueco y la regla de la peor categoría).

**Cuidado de interpretación.** La leyenda aclara que el color de la zona viene del dato de su estación y no es una medición de toda la comuna.

## 2026-10-13 — Número de comuna en el mapa y verificación de la zona de cada estación

**Qué se hizo.** El mapa muestra el número de cada comuna en el centro de su área, en gris suave y desde el zoom 10,5, y se oculta junto con la capa de comunas. La ficha de cada estación muestra su comuna o, en las rurales, su corregimiento (`zonaDe` en `web/src/util.js`, con una prueba nueva).

**Verificación contra la fuente oficial.** La capa `dagma:obs_aire_estaciones_monitoreo` de la IDESC trae la comuna y el barrio de cada estación del DAGMA. La zona que calcula el visor coincide en las nueve: Base Aérea (7), ERA - Obrero (9), Cañaveralejo (19), Universidad del Valle (17), Transitoria EDB Navarro (13), Compartir (21), La Flora (2), La Ermita (3) y Pance (53, el corregimiento de Pance, barrio La Viga). Cascajal, de la CVC, no está en esa capa y cae en el corregimiento El Hormiguero (52), al que pertenece la vereda Cascajal. El polígono del corregimiento de Pance es muy extenso hacia los Farallones y la estación está en su extremo oriental, por eso queda en una esquina del área coloreada.

**Problemas de calidad encontrados en las fuentes.**
- En esa misma capa de la IDESC, la estación La Ermita aparece con latitud y longitud 0,0. PIMAU usa para La Ermita las coordenadas verificadas del conector del portal de Cali, así que el visor no se afecta.
- Se confirmó de nuevo que el IDEAM publica Era Obrero con las coordenadas de Base Aérea (su punto cae en la comuna 7 y no en la 9). El visor agrupa las fuentes por nombre y usa las coordenadas de la IDESC, por eso la estación se muestra en la comuna correcta.

Ambos casos son ejemplos del problema que plantea el Capítulo 1: las fuentes oficiales tienen errores que solo aparecen al integrarlas y contrastarlas.

## 2026-10-21 — SATIC como fuente de datos recientes

**Contexto:** las fuentes con histórico largo (portal de Cali e IDEAM) terminan
en diciembre de 2024. El director indicó usar las mediciones de SATIC, que se
pueden descargar desde su geoportal.

### Lo que se encontró en SATIC

- **Geoportal:** https://satic.cali.gov.co (Alcaldía de Cali). Antes de entrar
  pide aceptar unos términos: los datos son de las entidades públicas que los
  proporcionan y el portal no garantiza su exactitud. No prohíben reutilizarlos.
- **Calidad del aire:** 16 estaciones de la red **OAC22** (Observatorio
  Ambiental de la Comuna 22, Alcaldía y EMCALI), en universidades, colegios y
  parques del sur de Cali, incluida la Universidad de San Buenaventura. Miden
  PM2.5, PM10, temperatura, humedad, dirección del viento y ruido, con datos
  del mismo día. También hay 30 estaciones de lluvia y 10 de nivel de ríos.
- **Descarga:** cada gráfica tiene un botón que genera, en el navegador, un
  Excel con los últimos 24 horas a 30 días de una variable de una estación.
  No hay una URL fija de descarga ni API pública.
- **Problemas de la fuente:**
  - La columna de unidad está errada en todas las variables (dice "CC, Cédula
    de Ciudadanía"; en las gráficas aparecen "M", "F", "CC" o "I").
  - Los umbrales de color del archivo (15, 30, 40 y 60 para PM2.5) no son los
    del ICA de la Resolución 2254 (12, 37, 55).
  - Las mediciones llegan cada 15 a 30 minutos, con huecos.
  - Cinco estaciones (San Martín, Bagatelle, Valle del Lili, Corazón de Pance y
    Las Garzas) no tenían datos ese día.

### Qué se construyó

- **Conector `satic.py`:** lee los Excel que el administrador deja en la
  bandeja `data/satic` (montada en el contenedor de ingesta). Asigna la unidad
  por variable, agrega las lecturas a promedios horarios fechados al final de
  la hora (la dirección del viento como promedio vectorial) y no guarda la
  primera ni la última hora de cada archivo, que pueden estar incompletas. Las
  estaciones con código desconocido se descartan con advertencia. El ruido
  (NOISE_AVG) todavía no se carga: llega con RF-15.
- **Migración 0005:** activa la fuente SATIC con tipo "Archivos exportados
  (Excel)".
- **Visor:** el texto de fuentes incluye SATIC.
- Es una prueba real del escenario 3: la fuente nueva fue un conector, una
  migración de datos y una línea en el registro de conectores, sin tocar la
  API ni el modelo de datos.

### Verificación

- 3 pruebas nuevas del conector (archivo real de Holguines y archivo
  sintético). Backend: 75 pasan y 16 se omiten sin base de pruebas local.
- Carga real: 27 horas de PM2.5 de Holguines Trade Center más 11 faltantes.
  La API y el visor muestran ICA 33 (Buena) con datos del 21 de octubre de 2026.

### Pendientes

- [ ] Descargar las demás estaciones y variables de SATIC (16 × 5).
- [ ] Agregar los códigos de las cinco estaciones sin datos cuando publiquen.
- [ ] Cargar el ruido cuando exista el parámetro (RF-15).

## 2026-10-21 — Descarga automática de SATIC cada hora

- **Carga inicial:** se descargaron los últimos 30 días de las 16 estaciones de
  la red OAC22. Catorce tienen datos (69 archivos, 79 MB) y se cargaron 41 273
  mediciones horarias en 12 segundos. Aparecieron tres estaciones que no tenían
  datos el primer día: San Martín, Bagatelle y Fundación Valle del Lili (código
  FVL). Corazón de Pance y Las Garzas no tienen datos en el último mes.
- **Descargador automático (`descarga_satic.py`):** un contenedor nuevo
  (`descarga-satic`) abre el geoportal con un navegador automatizado
  (Playwright), acepta los términos, recorre las estaciones y descarga cada
  variable de las últimas 24 horas. Corre cada hora. Cada archivo tiene un
  nombre fijo por estación y variable, se escribe con otro nombre y se renombra
  al final, así que la bandeja no crece y la ingesta nunca lee un archivo a
  medio escribir. Una corrida tarda unos 6 minutos y medio.
- **Por qué un navegador:** SATIC no tiene API pública y el Excel se genera en
  el navegador con los datos de la gráfica, sin una URL fija.
- **Riesgo:** si SATIC cambia su página, la descarga falla. El error queda en
  el registro del contenedor y la ingesta sigue con los archivos que ya tiene.
- **Retraso:** el conector no guarda la última hora de cada archivo, que puede
  estar incompleta, así que el visor queda una o dos horas detrás de SATIC.
- **Hallazgo:** la Universidad Javeriana reportó PM2.5 = 0,0 en la última hora,
  un valor sospechoso para la detección de anomalías (RF-13).

## 2026-10-22 — Prueba de los datos recientes y visor por vigencia

- **Prueba de los 30 días de SATIC (PM2.5 y PM10, 14 estaciones):**
  - **Sensor detenido:** la Universidad Javeriana marcó 0,0 en las 745 horas
    de PM2.5 y de PM10. El visor la mostraba como «Buena». Se agregó la bandera
    `sospechoso` (migración 0006): seis o más horas seguidas con el mismo
    promedio horario. Con esa regla, en los 30 días solo cae la Javeriana; la
    racha más larga de otra serie fue de 4 horas (dirección del viento en Valle
    del Lili). La lluvia y la radiación se excluyen porque pasan horas en cero.
    Las mediciones sospechosas no se usan para el ICA, y la API las informa en
    `ultima_marcada` para que el visor explique por qué no hay dato.
  - **PM10 de bajo costo:** en las 12 estaciones con PM2.5 y PM10, el PM10 fue
    casi igual al PM2.5 (razón media de 1,00 a 1,12; en 10 de ellas, más de la
    mitad de las horas exactamente igual). El PM10 incluye al PM2.5 y suele ser
    bastante mayor, así que el PM10 de SATIC y su ICA probablemente están
    subestimados. No se descarta el dato: la ficha lo advierte.
  - **Picos aislados:** San Martín llegó a 398 µg/m³ de PM2.5 y 568 de PM10 en
    una hora, y la Universidad Libre a 140 y 241. Están dentro del rango físico,
    así que quedan como válidos; son candidatos para la detección de anomalías
    del Semestre 8 (RF-13).
  - **Promedio bajo:** la Universidad Santiago de Cali promedió 1,4 µg/m³ de
    PM2.5, cuando las demás están entre 4 y 12. Puede ser su ubicación o el
    sensor; queda para revisar con la analítica.
- **Las horas de SATIC no son de Colombia:** al probar los datos recientes el
  visor mostraba mediciones de la madrugada del día siguiente. En los 69
  archivos descargados, la última lectura iba dos horas por delante de la hora
  UTC de la descarga: SATIC publica en UTC+2, siete horas por delante de
  Colombia. Todas las mediciones de SATIC estaban guardadas siete horas en el
  futuro. Se corrigió el conector (`satic_zona_horaria`, desfase fijo porque no
  se sabe si la plataforma cambia de horario en invierno) y la migración 0007
  movió las mediciones ya cargadas. Como protección, el conector descarta las
  lecturas que quedarían en el futuro y lo advierte en el registro. Solo con
  este ajuste el visor queda, como se esperaba, una a dos horas detrás de la
  hora real.
- **Minuto 24 confundido con la hora 24:** la lectura «21/10/2026 12:24:00» se
  leía como la medianoche del día siguiente, porque el patrón de la hora 24:00
  aceptaba cualquier «24:00» al final. Ahora exige un espacio o una T antes. En
  las fuentes horarias no ocurría (siempre terminan en :00); en SATIC afectó a
  las pocas lecturas tomadas exactamente a las hh:24:00.
- **Visor por vigencia:** el mapa pintaba igual un dato de hoy y uno de 2022, y
  coloreaba comunas con datos de hace años. Ahora muestra por defecto solo los
  datos de las últimas 48 horas, con la opción «Todo el histórico». Las
  estaciones sin datos se dibujan como un aro gris hueco, la lista separa las
  que tienen datos recientes de las que no, la etiqueta sobre el mapa dice
  cuántas estaciones tienen datos recientes y de cuándo es el último, y la
  antigüedad se cuenta en horas. El visor vuelve a pedir las estaciones cada
  10 minutos.
- **Ficha:** las fuentes con datos recientes muestran una gráfica de las
  últimas 48 horas con la guía de la OMS, y la ficha advierte las mediciones
  sospechosas y el PM10 de los sensores de bajo costo.

## 2026-10-22 — Incremento 3: administración (RF-10 y RF-11)

- **Comparación del código con el documento:** el MVP no estaba completo. Faltaba
  todo el incremento 3: no había inicio de sesión, las tablas `administrador` y
  `registro_auditoria` estaban vacías y el estado de la ingesta solo se veía por
  consola. El documento tampoco reflejaba la bandera `sospechoso`.
- **Bandera sospechoso en el documento:** antes de describirla como regla de
  RF-03 se revisaron las series históricas. Tienen miles de horas seguidas con
  el mismo valor, pero casi todas son reales: gases en 0 bajo el límite de
  detección (SO₂ hasta 336 horas seguidas en el IDEAM), viento en calma y
  humedad en 100 %. Por eso la regla queda solo para los sensores de bajo costo
  de SATIC, y así lo dice el documento.
- **API de administración (`api/admin.py`, `api/seguridad.py`):**
  - Inicio de sesión con token JWT de 30 minutos (PyJWT) y contraseñas con
    Argon2 (ADR-05). Las cuentas se crean por línea de comandos
    (`python -m pimau.api.administradores crear`), no desde la web.
  - Todas las rutas de administración exigen el token por una dependencia del
    enrutador: una ruta nueva queda protegida sin acordarse (acceso negado por
    defecto). Sin token, con token alterado o vencido responden 401 y el intento
    queda en el registro de auditoría (escenario 4, probado con 16 casos).
  - Cinco intentos fallidos bloquean el inicio de sesión 15 minutos, por IP y
    por correo. El mensaje es el mismo para correo y contraseña equivocados, y
    un correo inexistente tarda lo mismo en verificarse, para no revelar qué
    correos existen.
  - Rutas: fuentes con su última ejecución (RF-11), cambio de activación y
    frecuencia (RF-10, auditado con el valor anterior y el nuevo), ejecuciones
    recientes y registro de auditoría. Una fuente sin conector (OpenAQ) no se
    puede activar.
  - PyJWT 2.10.1 tenía vulnerabilidades publicadas (pip-audit): se usa 2.15.0.
- **Programador dinámico:** antes leía las fuentes una vez al arrancar, así que
  un cambio de frecuencia exigía reiniciarlo. Ahora revisa cada minuto qué
  fuentes tocan según su última ejecución, y cada fuente corre en su propio
  hilo. Se retiró APScheduler.
- **IP real de los clientes:** todas las solicitudes llegan por nginx, así que la
  API veía la misma IP para todos: el límite de 120 solicitudes por minuto por IP
  era en realidad un límite compartido. Ahora nginx envía la IP del cliente en
  X-Forwarded-For (reemplazando la que traiga, para que no se pueda inventar),
  la API la usa, y el puerto 8000 solo se publica en el propio equipo.
- **Panel del visor (flujo F3):** pestaña Administración habilitada, con la
  tabla de fuentes del boceto F3, los errores recientes y el registro de
  auditoría.
- **Estado del descargador de SATIC en el panel:** el panel mostraba SATIC como
  «Correcta» aunque la descarga llevaba 19 horas fallando, porque la ingesta
  solo lee los archivos ya descargados. Ahora el descargador deja el resultado
  de cada intento en `_estado_descarga.json` y, si no ha tenido éxito en 3
  horas, la ejecución de SATIC lo advierte.
- **Error encontrado al desplegar:** la imagen del descargador trae Python 3.10,
  que no tiene `datetime.UTC`, y el contenedor quedó reiniciándose. Las pruebas
  no lo detectaron porque corren con 3.12. Se corrigió y la integración continua
  ahora comprueba que el descargador carga dentro de su propia imagen.
- **La Alcaldía de Cali suspendió sus servicios web:** desde el 21 de octubre de
  2026, SATIC y el portal de Datos Abiertos de Cali responden con un comunicado
  de «suspensión temporal de servicios web por medidas de seguridad» (HTTP 403).
  Es el riesgo «una fuente deja de publicar» de la Tabla de riesgos: la
  plataforma siguió funcionando con los datos ya cargados, el descargador
  reintenta cada hora y el panel muestra la advertencia.

## 2026-10-23 — Exploración del agrupamiento (k-means, codo y silueta)

- **H₂S solo en el histórico:** el sulfuro de hidrógeno tiene datos en ERA-Obrero,
  La Flora y Transitoria Navarro (unas 67 000 horas, 2010-2020), pero no tiene
  ICA ni datos recientes. Se quitó del selector del mapa y sigue en el Histórico;
  la regla es general: en el mapa solo van los contaminantes con ICA.
- **Script:** `analitica/exploracion/agrupamiento.py` (consultas en
  `consultas.sql`, resultados en `resultados/`). Sigue la sección 2.1.9: k-means
  con variables estandarizadas, k elegido con el codo y la silueta, y Davies-Bouldin.
- **Estaciones por la forma del ciclo diario de PM2.5** (calculado antes de corregir
  la hora de SATIC; ver la entrada siguiente): la mejor silueta fue
  con k = 2 (0,37), pero los grupos casi coinciden con la red: uno reúne las
  series del DAGMA y el IDEAM (2010-2024, pico amplio de 8 a 15 h y mínimo a las
  18 h) y otro las de SATIC (un mes de 2026, pico marcado a las 7-8 h y mínimo a
  las 15-16 h). El agrupamiento separa sobre todo periodos y redes. Comparando
  solo SATIC (mismo periodo), las 12 estaciones del sur tienen la misma forma y
  la única distinta es San Martín (pico a las 11 h), la de los picos de 398 µg/m³:
  el agrupamiento la aísla como caso anómalo.
- **Tipos de día (PM2.5, temperatura, humedad, viento y lluvia):** 2 154 días con
  las cinco variables completas. La inercia baja sin un codo claro y la silueta
  queda entre 0,26 y 0,30 (estructura débil); con k = 6:
  - un grupo de días lluviosos (24 mm) que sube en abril-mayo y octubre-noviembre,
    las temporadas de lluvia de Cali, lo que respalda que los grupos tienen sentido;
  - un grupo de días contaminados (30,5 µg/m³) con poco viento (1,1 m/s), sobre
    todo en enero-marzo y en la Universidad del Valle (46 % de sus días);
  - **un grupo con humedad promedio de 12 %, imposible en Cali:** es la falla del
    sensor de humedad de Pance (IDEAM) entre abril y junio de 2020 (13 % en
    mayo), durante el aislamiento por COVID-19. El agrupamiento sirvió como
    control de calidad.
  - los demás grupos separan estaciones más que tipos de día (el viento medido
    depende mucho de dónde está el anemómetro).
- **Lecciones para el incremento 4:** comparar estaciones en el mismo periodo,
  estandarizar cada variable por estación antes de juntar días de varias
  estaciones, y usar el agrupamiento también para encontrar sensores que fallan.

## 2026-10-23 — Ruido, anomalías y alertas (RF-13, RF-14 y RF-15)

- **Ruido (RF-15):** parámetro RUIDO en dB(A) con la variable `NOISE_AVG` de
  SATIC. El promedio horario es energético (nivel equivalente): 50 y 70 dB dan
  67 dB, no 60; igual en el resumen diario de la API. Referencia: Resolución 627
  de 2006, artículo 17, Tabla 2, sector B (zonas residenciales, universidades,
  colegios y parques urbanos), 65 dB(A) de día y 50 de noche; el horario diurno
  va de 7:01 a 21:00. El visor compara cada valor con el límite de su periodo y
  advierte que el límite real depende del uso del suelo de cada estación. El
  portal de Datos Abiertos de Cali también publica ruido, pero sigue fuera de
  línea: su conector queda pendiente.
- **Anomalías (RF-13):** servicio analítico nuevo (`pimau/analitica`, contenedor
  `analitica`, ADR-06) que cada hora entrena un Isolation Forest por serie con el
  último año de mediciones válidas. Características: valor, hora del día (seno y
  coseno), cambio respecto a la hora anterior y diferencia con la mediana de las
  24 horas anteriores. Cada modelo se guarda con skops y un JSON con el periodo,
  la fecha, el resultado y las versiones de las librerías (`./modelos`).
  - **Calibración del umbral del puntaje:** cinco series sintéticas de 60 días
    con 20 picos y 20 valores moderados de madrugada cada una. Con 0,58, 0,60 y
    0,62 el F1 fue casi igual (0,80, 0,79 y 0,81); se eligió 0,62 por su mayor
    precisión (0,93), con exhaustividad de 0,72: encuentra todos los picos y el
    45 % de las anomalías contextuales. En las series reales marca entre el 1 y el
    3 % de las horas de PM2.5. La primera calibración, con scikit-learn 1.9 y una
    sola serie, daba 0,60; con la versión de la plataforma (1.6.1) cambió, y por
    eso la prueba promedia cinco series.
  - **Revisión de toda la historia:** 60 segundos, 133 modelos y unas 19 000
    anomalías (0,3 a 2 % de las horas según la variable). San Martín muestra
    picos casi diarios a comienzos de octubre, de hasta 438 µg/m³.
  - En el mapa se señalan solo las estaciones cuyo último dato es anómalo, para
    no llenarlo de marcas; en la ficha y en las gráficas se ven todas.
  - scikit-learn 1.6.1 y skops 0.13.0 (la 0.11.0 tenía vulnerabilidades publicadas).
- **Alertas (RF-14):** tabla `umbral_alerta` (no estaba en el modelo de datos;
  se agregó al diagrama), un umbral por parámetro configurable en el panel y
  auditado. Una alerta está activa si la medición de las últimas 3 horas iguala o
  supera el umbral, incluido el valor igual al límite (criterio del Anexo A). Se
  calcula sobre el estado de las estaciones que ya está en caché, sin recorrer las
  mediciones. Las alertas sobre los pronósticos quedan para cuando exista RF-12.
  Mientras SATIC esté fuera de línea no hay mediciones recientes, así que no se
  ven alertas en el visor; las pruebas automáticas cubren el caso.
- **Corrección de la hora de SATIC (corrige la entrada del 2026-10-22):** al
  revisar las anomalías apareció una serie con cinco horas repetidas cinco horas
  después. La hipótesis de UTC+2 era equivocada: se había deducido de la última
  lectura de cada archivo, sin contar que SATIC publica con unas tres horas de
  retraso. Se comparó el ciclo diario de temperatura de SATIC con el del IDEAM en
  Cali (máximo a las 14 h, mínimo a las 5 h): **SATIC guarda la hora de Colombia
  como si fuera UTC y su página la muestra en la zona del navegador**. Los
  archivos del descargador (navegador en UTC) tenían el reloj 10 horas por
  delante de Colombia, y los de la carga inicial (navegador en hora de Colombia),
  5 horas. Por eso las mediciones guardadas tenían dos errores distintos: la
  carga inicial quedó 2 horas antes y la del descargador 3 horas después.
  - El descargador ahora usa la zona de Colombia, igual que una descarga manual
    hecha en Cali, y el conector lee la hora del archivo como UTC.
  - La migración 0009 corrigió cada grupo con su desfase y dejó una sola fila
    cuando las dos descargas vieron la misma hora. Antes se guardó un respaldo
    completo (`respaldos/pimau_antes_migracion_0009.dump`). Los archivos viejos
    quedaron aparte en `data/satic/_descargados_con_navegador_utc`.
  - Verificación: el ciclo de temperatura de SATIC quedó sin desfase respecto al
    IDEAM (correlación 0,99).
- **Agrupamiento repetido con la hora corregida:** la mejor silueta pasó a k = 5
  (0,31). SATIC forma un grupo con pico a las 9-10 h (lecturas de las 8-9 h);
  las series del IDEAM se separan por la hora del pico: Pance, Cascajal y la
  Universidad del Valle a las 14-15 h y las demás en la mañana. Dentro de SATIC
  se mantiene que todas se parecen y San Martín es la anómala.

## 2026-10-26 — Diseño, accesibilidad y celular en el visor

Revisión de las tres pantallas (Mapa, Histórico y Administración) a 1440×900 y
a 375×812 con los principios de las guías de interfaz de Apple aplicados a la
web (accesibilidad, color, tipografía, diseño y textos), más pruebas con datos
extremos, zoom al 200 % y solo teclado. Objetivo: WCAG 2.2 AA (RNF-07). Los
colores del ICA (Resolución 2254 de 2017) no cambiaron y la categoría siempre
va con su nombre. No se tocaron la API ni lo que muestran los datos.

- **Contraste (WCAG 1.4.3 y 1.4.11), medido con la fórmula de WCAG:**

  | Elemento | Antes | Después |
  | --- | --- | --- |
  | Texto secundario (`--tinta-tenue`, unos 60 rótulos de 12–13 px) | #7a8783, 3,74:1 | #5f6d69, 5,42:1 sobre blanco y 4,95:1 sobre el fondo |
  | Anillo de foco | #e0a100, 2,27:1 | #b06f00, 4,10:1 |
  | Borde de campos y selectores | #e3e8e6, 1,24:1 | #858f8c, 3,33:1 |
  | Gris de «sin ICA» en el mapa | #9aa3ad, 2,33:1 | #7d8790, 3,34:1 |
  | Rótulos del mapa base | #8a9692, 2,80:1 | #66736f, 4,52:1 sobre el fondo del mapa |

- **Tamaño de los controles (WCAG 2.5.8):** las opciones del mapa pasaron de
  20 a 24 px de alto. En pantallas táctiles (`pointer: coarse`) todos los
  controles miden 44 px: pestañas (antes 41), selector de variable (35), filas
  de la lista (39), zoom del mapa (29×29) y botones (37).
- **Diseño adaptable (WCAG 1.4.10):** a 375 px el Histórico medía 459 px de
  ancho (el selector de estación no se encogía) y Administración 785 px (los
  textos ocultos de los encabezados escapaban del scroll de la tabla). Ahora
  ambas miden 375 px. Con zoom al 200 % la tarjeta de opciones del mapa quedaba
  cortada; ahora hace scroll.
- **Foco y lector de pantalla:** al elegir una estación el foco pasa al nombre
  en la ficha, y la ficha queda a la vista aunque haya alertas encima (con doce
  alertas la ficha quedaba fuera del panel) o, en el celular, debajo del mapa.
  Se quitó el `aria-live` de la ficha, que la releía completa cada diez minutos.
  Los controles de MapLibre tienen textos en español y cada sección tiene su
  título de página.
- **Celular:** `100dvh` y `62svh` en vez de `100vh`; campos de 16 px en pantallas
  táctiles (con 14 px iOS acerca la página al enfocarlos); `viewport-fit=cover`
  con márgenes `env(safe-area-inset-*)`; color de la barra del navegador por
  modo; `touch-action: manipulation` y sin el destello al tocar; `:hover` solo
  con mouse. En pantallas táctiles el mapa se mueve con dos dedos
  (`cooperativeGestures`), para que un dedo desplace la página. Por debajo de
  1180 px el aviso del estado de los datos se ocultaba y por debajo de 900 px
  la leyenda del ICA; ahora van arriba del panel y dentro de él.
- **Estados:** mientras carga, la ficha dice «Cargando las estaciones…»; sin
  estaciones, «No hay estaciones para mostrar» (antes pedía elegir una
  estación que no existía); un error de la API ofrece «Reintentar».
- **Oficio:** los avisos de la ficha (alerta, datos no confiables, anomalía y
  nota de la fuente) van en orden de gravedad y cada uno con su título; las
  alertas dicen de qué fuente son; el eje Y del histórico usa marcas redondas
  (0, 50, 100…; antes terminaba en 223); en Administración el botón de cada fila
  solo resalta si hay algo que guardar, confirma «Guardado» en la misma fila sin
  perder el foco y el umbral avisa si no es un número mayor que 0.
- **Modo oscuro:** sigue la preferencia del sistema, sin interruptor propio.
  Todos los colores pasaron a tokens con su variante oscura (texto entre 4,87:1
  y 13,8:1; bordes y gráficos de 3,6:1 o más). El mapa base cambia al estilo
  oscuro de OpenFreeMap y el relleno de las comunas baja a 0,12, porque más
  opaco el amarillo del ICA se veía verde oliva.
- **Movimiento, solo donde explica un cambio:** fundido de 160 ms al cambiar de
  estación; el marcador del ICA se desliza 240 ms (con `transform`) al cambiar
  de variable; los botones se encogen a 0,97 al presionarlos (120 ms); la fila
  guardada se resalta 1,2 s. La regla anterior de `prefers-reduced-motion`
  anulaba todo; ahora quita los desplazamientos y conserva fundidos y cambios
  de color. Se corrigió que el mapa volviera a la estación elegida con cada
  actualización de diez minutos. Se descartaron animar las pestañas, la lista,
  las gráficas, los anillos de alerta y los colores del mapa.
- **Casos extremos en desarrollo:** `?datos=peor`, `?datos=vacio` y
  `?datos=error` cambian las respuestas de la API por nombres largos, doce
  alertas, valores en el tope del ICA, una lista vacía o un error. Solo existe
  en desarrollo y no entra en el build.
- **Pendiente:** probar en un celular real (la emulación del navegador no
  reproduce la barra del navegador, el teclado ni el zoom de iOS) y revisar el
  movimiento con `review-animations`.

## 2026-11-04 — Plan de mejora de la interfaz y su ejecución

Se ejecutó el plan de [plan_mejora_interfaz.md](plan_mejora_interfaz.md) en
siete fases, con las skills de los plugins Design, VectorLab, frontend-design,
Perf Profiler y dataviz. Cada fase quedó en su propio commit.

- **Errores encontrados al medir el build de producción con una API simulada:**
  el riel del marcador del ICA (commit 6b769bb) ensanchaba la página en el
  celular (473 px en 375, y hasta 1470 px en 768 con ICA alto) y el panel de
  escritorio; con «Dañina a la salud de grupos sensibles» el nombre se encimaba
  con el estado en la lista; a 1366 × 768 y 1280 × 800 la leyenda tapaba las
  casillas de los límites, que seguían recibiendo el foco (la revisión del 26 de
  octubre se hizo a 1440 × 900); en un mapa bajo el encuadre no mostraba ninguna
  estación; y la selección de estación era un índice que podía cambiar con cada
  actualización.
- **nginx no comprimía:** la imagen oficial trae gzip apagado, así que el mapa
  (cerca de 1 MB), las gráficas y las capas de la IDESC viajaban sin comprimir.
  Se activó gzip, también para las respuestas de la API.
- **Pruebas de extremo a extremo y de accesibilidad (cierra el pendiente de
  RNF-07):** 68 pruebas con Playwright 1.63 y axe-core 4.14 contra el build, con
  una API simulada, en escritorio y celular, claro y oscuro. axe no encuentra
  violaciones WCAG 2.2 A/AA. Corren en CI (job `e2e`) y guardan una captura de
  cada vista. Con el código anterior, las de reflujo fallan.
- **Interfaz:** estado en la URL (enlaces por estación y por consulta del
  Histórico, «Atrás» funciona), buscador en la lista, enlace para saltar al
  panel, ficha que empieza por la categoría del ICA con avisos breves y su porqué
  plegado, leyenda plegada en el celular, escala tipográfica con tokens (de 19
  tamaños a 12 y 14 px más tres títulos; pesos 400, 600 y 700), errores con
  detalle técnico copiable, y en el Histórico atajos de periodo, estaciones según
  la variable y comparación de dos series con un segundo color validado.
- **Rendimiento (Lighthouse 13.5, móvil, mediana de tres corridas, API simulada):**
  rendimiento 65 → 86, FCP 3,8 → 2,6 s, LCP 4,2 → 3,7 s, CLS 0,244 → 0,029. La
  carga inicial bajó de 426 a 56 kB de JavaScript con gzip: el mapa, el Histórico,
  la Administración y las gráficas se cargan en diferido. Un presupuesto en CI
  (`npm run presupuesto`) impide que vuelva a crecer.
- **Descartados, con su motivo en el plan:** el Brush de Recharts (sus controles
  quedarían dentro de una gráfica marcada como imagen), pedir los datos antes de
  pintar (no cambió la medición), la retícula de 8 px y los objetivos de 44 px
  con mouse del catálogo de VectorLab.
- **Pendiente:** la prueba con cinco personas y la revisión en celulares reales,
  con el guion de [guion_prueba_usuarios.md](guion_prueba_usuarios.md); con sus
  resultados se decide si la ficha del celular necesita una hoja inferior.

## 2026-11-04 — SATIC volvió y los faltantes ya no bloquean los datos tardíos

- **SATIC volvió:** el geoportal responde otra vez (200). Estuvo caído desde el
  2026-10-22 02:44 UTC; el descargador reintentó cada hora con
  `TimeoutError` y el panel mostró la advertencia, como prevé el escenario 6. Al
  encender la plataforma, la descarga de las 05:23 UTC trajo 65 archivos.
- **Error encontrado:** la primera ingesta tras la caída cargó desde el 2 de
  noviembre y `completar_faltantes` llenó del 22 de octubre al 2 de noviembre
  con filas sin valor. Una descarga de 15 días trajo después el 31 de octubre y
  el 1 de noviembre, pero el `ON CONFLICT DO NOTHING` los descartaba porque esas
  horas ya existían como faltantes.
- **Arreglo:** si una hora guardada sin valor llega después con valor, el valor
  la reemplaza, con la procedencia de la ejecución que lo trajo. Un valor ya
  guardado nunca se reemplaza. Prueba nueva:
  `test_un_valor_que_llega_tarde_reemplaza_al_faltante` (110 pruebas pasan).
- **Relleno:** con `descarga_satic --rango "Últimos 15 días"` e ingesta
  `--completa` entraron 3 943 mediciones. SATIC no tiene datos del 22 al 30 de
  octubre (su propia descarga los omite), así que esos días quedan como faltantes.
- **Portal de Datos Abiertos de Cali:** sigue con 403. No afecta, porque su
  histórico ya está cargado y la fuente no publica datos nuevos desde 2020.
