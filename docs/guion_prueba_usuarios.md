# Prueba con usuarios del visor y revisión en celulares reales

Guion para las dos partes del plan de mejora
([plan_mejora_interfaz.md](plan_mejora_interfaz.md)) que no se pueden hacer
desde un contenedor: ver a personas reales usando el visor y revisarlo en
teléfonos de verdad. Preparado con la skill `user-research` del plugin Design.

## 1. Prueba de usabilidad

### Objetivo

Saber si una persona que no conoce el proyecto entiende cómo está el aire cerca
de un lugar, si nota una alerta y si consigue los datos de un periodo. Las
preguntas concretas:

1. ¿La categoría del ICA, que ahora encabeza la ficha, se entiende sin ayuda?
2. ¿Los avisos (alerta, datos no confiables, valor anómalo) se leen como algo
   distinto del dato, y alguien abre «¿Qué significa?»?
3. ¿Encuentran una estación por la lista, por el buscador o por el mapa?
4. ¿El Histórico se usa sin explicación: estación, variable, periodo y descarga?

### Participantes

Cinco personas ajenas al proyecto. Con cinco aparecen la mayoría de los
problemas de una pantalla; más personas repiten lo mismo.

- Al menos dos que nunca hayan oído del ICA.
- Al menos dos que hagan la prueba en su propio celular.
- Si se puede, una persona que use lector de pantalla o zoom grande.
- Variedad de edades. Nadie del grupo del trabajo de grado.

### Preparación

- El visor desplegado con datos reales, o local con `docker compose up -d`.
  Sin datos recientes de SATIC, la tarea 2 se cambia por la versión con «Todo
  el histórico» (ver abajo).
- Consentimiento informado de palabra o por escrito: qué se observa, que se
  puede parar en cualquier momento y que no se guardan datos personales (Ley
  1581 de 2012). Si se graba la pantalla, que no se vea la cara ni el nombre.
- Una persona guía y otra toma notas. La guía no explica la interfaz ni
  corrige: si la persona pregunta, se le devuelve la pregunta («¿Qué cree que
  haría?»).

### Sesión (30 a 40 minutos)

**Inicio (5 min).** «Estamos probando la página, no a usted. No hay respuestas
malas. Le pido que piense en voz alta mientras la usa.»

**Contexto (5 min).**
- ¿Alguna vez ha buscado información sobre la calidad del aire? ¿Dónde y para qué?
- ¿Qué haría si supiera que el aire está malo hoy cerca de su casa o su trabajo?

**Tareas (20 a 25 min).** Se leen tal cual, una por una. Después de cada una:
«Del 1 al 7, ¿qué tan fácil fue?» (1 muy difícil, 7 muy fácil).

| # | Tarea (lo que se le dice) | Se cumple si… | Qué observar |
| --- | --- | --- | --- |
| 1 | «Quiere saber cómo está el aire cerca de la Universidad de San Buenaventura. Averígüelo.» | Dice la categoría (por ejemplo, «Buena») y de cuándo es el dato. | ¿Usa el mapa, la lista o el buscador? ¿Lee la categoría o la cifra? ¿Entiende «ICA»? |
| 2 | «¿Hubo hoy alguna estación con el aire en mal estado? ¿Cuál?» | Encuentra la alerta o una estación naranja o peor. | ¿Ve el aviso de alertas? ¿Entiende el anillo rojo del mapa? Versión sin datos recientes: «¿Cuál estación tenía el peor aire la última vez que midió?» con «Todo el histórico». |
| 3 | «En una estación aparece un aviso. ¿Qué le está diciendo?» (se abre una con valor anómalo o datos no confiables) | Explica con sus palabras que el dato puede no ser confiable o que es raro. | ¿Abre «¿Qué significa?»? ¿Confunde «anómalo» con «peligroso»? |
| 4 | «Descargue los datos de PM2.5 de octubre de una estación para abrirlos en Excel.» | Descarga el CSV con el periodo correcto. | ¿Encuentra el Histórico? ¿Usa los atajos o las fechas? ¿Entiende cuándo la serie pasa a promedios diarios? |
| 5 | «Mándele a un amigo el enlace de la estación que miró en la tarea 1.» | Copia un enlace que abre esa estación. | ¿Usa «Copiar el enlace de esta estación» o la barra del navegador? |

**Cierre (5 min).**
- ¿Qué fue lo más confuso?
- ¿Qué le sobra a la página? ¿Qué le falta?
- Si tuviera que explicarle a alguien qué significa el color naranja, ¿qué diría?

### Qué se anota

Por tarea: si se cumplió (sí, con ayuda o no), el tiempo aproximado, el puntaje
de 1 a 7 y frases textuales. Las frases valen más que las opiniones generales.

### Cómo se resume

1. Pasar cada observación a una nota corta («No vio la alerta hasta bajar»).
2. Agrupar las notas parecidas y ponerle nombre a cada grupo.
3. Ordenar los grupos por cuántas personas tuvieron el problema y por qué tanto
   les impidió terminar la tarea.
4. Llevar los tres primeros al plan de mejora como hallazgos nuevos, con la
   evidencia (cuántas personas y una frase textual).

| Problema | Personas (de 5) | ¿Impidió la tarea? | Frase textual | Cambio propuesto |
| --- | --- | --- | --- | --- |
| | | | | |

## 2. Revisión en celulares reales

La emulación del navegador no reproduce la barra del navegador, el teclado ni
el zoom de iOS. Esta lista se recorre en un iPhone con Safari y en un Android
con Chrome, en modo claro y oscuro.

- [ ] La página no se desplaza de lado en ninguna pestaña, con y sin ficha.
- [ ] Al elegir una estación de la lista, la ficha queda a la vista.
- [ ] El mapa se mueve con dos dedos y la página con uno.
- [ ] Los campos de fecha, búsqueda y umbral no acercan la página al tocarlos.
- [ ] El teclado no tapa el campo que se está escribiendo.
- [ ] La barra del navegador no corta el pie de la página ni el panel.
- [ ] Con el texto del sistema al 200 %, la ficha y la lista se leen enteras.
- [ ] VoiceOver (iOS) y TalkBack (Android): se elige una estación de la lista,
      se anuncia su nombre y se puede leer la ficha de arriba abajo.
- [ ] «Copiar el enlace de esta estación» copia y el enlace abre la misma ficha.
- [ ] Rotar el teléfono a horizontal: el mapa muestra las estaciones.

Lo que falle se anota en la bitácora con el modelo de teléfono, el navegador y
una captura.
