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

