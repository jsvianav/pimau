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
- [ ] Verificar los puntos de corte del ICA contra la Resolución 2254 de 2017.
- [ ] Cargar Base Aérea desde el archivo CSV del portal de Cali.
- [ ] Generar los faltantes implícitos del IDEAM según la frecuencia horaria.
- [ ] Cargar la capa de corregimientos de la IDESC.
- [ ] Actualizar el Capítulo 3 con los hallazgos de esta entrada.
- [ ] Incremento 2: API de consulta y visor.
