# Plan de funcionalidades de PIMAU a partir de visores parecidos

5 de noviembre de 2026

Este plan compara PIMAU con visores de calidad del aire de Colombia y de otros
países, y propone lo que le falta. Respeta lo que ya decidió la tesis:

- el pronóstico es Prophet, comparado con SARIMAX, con la media móvil de 7 días
  como línea base (ADR-06 y sección 3.4);
- los colores del ICA no cambian;
- SATIC solo se usa con lo que la Alcaldía permita.

No reemplaza a `plan_mejora_aplicacion.md`, que se decidió no aplicar.

## 1. Con qué se comparó

| Visor | Quién lo publica | Qué tiene que sirve de referencia |
|---|---|---|
| SIATA | Área Metropolitana del Valle de Aburrá | Mapa de estaciones con el ICA, pronóstico de PM2.5 de hasta tres días con modelos estadísticos, boletines y alertas |
| IBOCA y su mapa | Secretarías de Ambiente y de Salud de Bogotá | Índice con recomendaciones de salud por nivel y un mapa que se consulta a cualquier hora |
| AirNow | EPA (Estados Unidos) | Recomendaciones de actividad por categoría para grupos sensibles y para todos |
| IQAir AirVisual | Empresa privada | Pronóstico, recomendaciones de salud, avisos cuando el aire pasa el nivel que elige el usuario, histórico |
| AQICN y OpenAQ | Proyectos abiertos | API pública documentada y datos descargables |

## 2. Qué tiene PIMAU frente a ellos

| Funcionalidad | SIATA | IBOCA | AirNow | IQAir | PIMAU |
|---|---|---|---|---|---|
| Mapa con el índice por estación | Sí | Sí | Sí | Sí | Sí |
| Histórico descargable | Parcial | Parcial | Sí | Pago | **Sí, desde 2010, en CSV** |
| Procedencia y calidad de cada dato | No | No | No | No | **Sí (banderas y ejecución de ingesta)** |
| Anomalías señaladas | No | No | No | No | **Sí (Isolation Forest)** |
| Ruido ambiental | No | No | No | No | **Sí (Res. 627 de 2006)** |
| Comunas y barrios | Municipios | Localidades | No | No | **Sí (IDESC)** |
| Pronóstico | Sí | Sí | Sí | Sí | No (RF-12, Semestre 8) |
| Qué hacer según la categoría | Sí | Sí | Sí | Sí | **No** |
| Avisos al usuario | Redes y boletines | Alertas públicas | Correo y app | App | Solo dentro del visor |
| Ciclo del día (a qué hora está peor) | Sí | No | No | Parcial | **No** |
| Página que explique fuentes y límites | Sí | Sí | Sí | Sí | **No** |
| API pública enlazada | No | No | Sí | De pago | Sí, en `/api/docs`, enlazada desde el panel y el pie |

Lo que distingue a PIMAU es la transparencia del dato. Lo que le falta es lo que
ayuda al ciudadano a decidir: qué hacer, a qué hora y qué viene.

## 3. Tareas

Esfuerzo: S, hasta un día; M, de dos a cuatro días; L, una semana o más.

### F1 · Qué hacer según la categoría del ICA (alta prioridad, S)

- **Por qué:** SIATA, IBOCA, AirNow e IQAir acompañan cada nivel con una
  recomendación. En PIMAU la ficha dice «Dañina para grupos sensibles» pero no
  qué hacer.
- **Cómo:** un texto corto por categoría en la ficha, con la fuente citada al
  lado. El texto sale **solo de una fuente oficial**: primero la Resolución 2254
  de 2017 o una publicación del Ministerio de Ambiente o del IDEAM; si no la
  tienen, la guía de la EPA, que es la del índice en que se basa el ICA. Se
  define quiénes son los grupos sensibles (niños, adultos mayores, personas con
  enfermedades del corazón o de los pulmones).
- **Listo cuando:** las seis categorías tienen su texto con la fuente, y una
  prueba de extremo a extremo lo verifica.

### F2 · Página «Acerca de» (alta prioridad, S)

- **Por qué:** todos los visores revisados explican de dónde salen los datos y
  qué limitaciones tienen. PIMAU lo explica en la tesis, pero no en la página.
- **Cómo:** una sección corta con las fuentes y su estado (SATIC con datos
  recientes, el portal de Cali y el IDEAM como históricos), qué es el ICA, qué
  significan las banderas y las anomalías, las limitaciones (cobertura del sur
  de la ciudad, no es un dato oficial), el enlace a la API y quién hizo el
  proyecto.
- **Listo cuando:** se llega a ella desde el encabezado y pasa la revisión de
  accesibilidad.
- **Estado:** hecho el 5 de noviembre (pestaña «Acerca de» y enlace en el panel).

### F3 · Enlazar la API pública (alta prioridad, S)

- **Por qué:** AQICN y OpenAQ ofrecen sus datos por API. PIMAU ya la tiene
  documentada en `/api/docs` y enlazada desde el panel y el pie, pero sin
  ejemplos de uso. Encaja con los datos
  abiertos del marco teórico (Ley 1712 de 2014).
- **Cómo:** en «Acerca de», el enlace con tres ejemplos de consulta.
- **Listo cuando:** los ejemplos abren datos reales en producción.
- **Estado:** hecho el 5 de noviembre, junto con F2.

### F4 · Ciclo del día por estación (media prioridad, S)

- **Por qué:** saber a qué hora suele estar peor el aire ayuda a decidir cuándo
  salir a hacer ejercicio. La exploración del agrupamiento ya lo calculó.
- **Cómo:** en el Histórico, una gráfica del promedio por hora del día del
  periodo elegido, con la hora local.
- **Listo cuando:** la gráfica aparece para el PM2.5 y el ruido, con su tabla
  equivalente para lectores de pantalla.
- **Estado:** hecho el 5 de noviembre. Excluye la dirección del viento, que es
  un ángulo y no se puede promediar así.

### F5 · Contexto del dato (media prioridad, S)

- **Por qué:** IQAir compara el valor actual con lo habitual. Un número solo no
  dice si es mucho o poco para esa estación.
- **Cómo:** en la ficha, una línea como «más alto que el 80 % de las horas de
  este mes en esta estación», calculada con el histórico de la misma estación.
- **Listo cuando:** la API lo devuelve y la prueba cubre una estación sin
  suficiente histórico.

### F6 · Viento en el mapa (media prioridad, M)

- **Por qué:** el viento explica hacia dónde se mueve la contaminación, y SATIC
  ya trae dirección y velocidad.
- **Cómo:** una flecha por estación con la dirección y la velocidad de la última
  hora, que se activa como una capa más. En el Histórico, una rosa de vientos.
- **Listo cuando:** la capa se puede prender y apagar, y la flecha tiene texto
  alternativo.

### F7 · Avisos por correo (baja prioridad, M)

- **Por qué:** IQAir y AirNow avisan cuando el aire pasa un nivel. PIMAU ya
  calcula las alertas, pero solo se ven si alguien entra al visor.
- **Cómo:** suscripción con correo y confirmación (doble aceptación), por
  estación y nivel, con un enlace para darse de baja en cada mensaje.
- **Cuidado:** guarda datos personales, así que aplica la Ley 1581 de 2012:
  aviso de privacidad, solo el correo, borrado al darse de baja.
- **Listo cuando:** el aviso llega una sola vez por episodio y la baja funciona
  con un clic.

### F8 · Pronóstico en el visor (alta prioridad, L; ya planeado)

- **Por qué:** es lo que más tienen los demás y lo que falta del incremento 4.
- **Cómo:** el de la tesis, sin cambios: Prophet comparado con SARIMAX, línea
  base de media móvil de 7 días, MAE, RMSE y MASE con origen móvil. En el visor,
  el valor esperado con su intervalo y una nota de que es una estimación del
  proyecto, no oficial.
- **Listo cuando:** se cumple el criterio de la sección 3.4 de la tesis.

## 4. Lo que no se propone, y por qué

| Idea | Por qué no |
|---|---|
| Mapa de calor interpolado | Con 12 a 16 estaciones concentradas en el sur, mostraría valores inventados en zonas sin medición. Queda como trabajo futuro, con esa advertencia. |
| Cambiar los colores del ICA | El ICA se reconoce por sus colores. El contraste se mejora con el borde del marcador, sin cambiarlos. |
| Saltarse el bloqueo de SATIC a Azure | Requiere el permiso de la Alcaldía. |
| App nativa para celular | El visor ya funciona en el celular; no aporta a los objetivos de la tesis. |
| Inglés | La audiencia es Cali. |

## 5. Orden sugerido

| Semana | Tareas | Resultado |
|---|---|---|
| 1 | F1, F2, F3 | El ciudadano sabe qué hacer y entiende de dónde salen los datos |
| 2 | F4, F5 | Contexto del dato y mejor hora del día |
| 3 | F6 | Viento en el mapa |
| Semestre 8 | F8, y F7 si queda tiempo | Pronóstico y avisos |

F1, F2 y F3 son baratas, se notan en la sustentación y se pueden citar en el
Capítulo 4 como mejoras a partir del análisis de antecedentes (Tabla 6 de la
tesis).

## Fuentes

- SIATA, pronóstico de calidad del aire: https://www.eltiempo.com/colombia/medellin/en-medellin-enviaran-predicciones-sobre-como-estara-la-calidad-del-aire-3383796
- Mapa de calidad del aire de Bogotá (IBOCA): https://bogota.gov.co/mi-ciudad/ambiente/mapa-de-la-calidad-del-aire-en-bogota
- Tabla de categorías de AirNow: https://www3.epa.gov/airnow/mobile/AQItable.htm
- IQAir AirVisual: https://www.iqair.com/air-quality-monitors/air-quality-app
