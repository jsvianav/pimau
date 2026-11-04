# Plan de mejora de la interfaz del visor

4 de noviembre de 2026 · rama `claude/plan-mejora-interfaz-khegj8`

Este plan sale de tres fuentes: la lectura del código de `web/`, la bitácora
(sobre todo la revisión del 2026-10-26) y una auditoría del build de
producción. Reúne lo que se encontró, las skills, agentes y plugins que sirven
para cada parte y un orden de trabajo.

## 1. Punto de partida

### Lo que ya funciona

La revisión del 26 de octubre dejó una base que no hay que rehacer:

- Colores en tokens con variante oscura y contraste medido, foco visible de
  4,1:1 y controles de 44 px en pantallas táctiles.
- Estados de carga, vacío y error en la ficha, y casos extremos en desarrollo
  (`?datos=peor|vacio|error`).
- Movimiento solo donde explica un cambio, con su versión para «reducir
  movimiento».
- La lista de estaciones como alternativa accesible al mapa.

**axe-core 4.10 no encontró ninguna violación** (reglas WCAG 2.0, 2.1 y 2.2
A/AA, más buenas prácticas) en las diez vistas revisadas: mapa con y sin ficha,
claro y oscuro, Histórico, inicio de sesión y panel de Administración, a
1440 × 900 y a 375 × 812.

### Cómo se midió

- `npm run lint`, `npm test` (18 pruebas) y `npm run build` pasan.
- El build se sirvió con `vite preview` y se recorrió con el Chromium de
  Playwright. La API se simuló interceptando `/api/*` con datos inventados que
  siguen `backend/pimau/api/esquemas.py`: 18 estaciones de las tres fuentes,
  una alerta, una anomalía y un sensor detenido.
- OpenFreeMap no responde desde el contenedor donde se hizo la auditoría, así
  que el estilo del mapa se cambió por uno mínimo (solo el fondo). Se ven las
  estaciones y las zonas coloreadas; los rótulos y el mapa base, no. Las
  comunas de las capturas son una rejilla falsa.

### Hallazgos confirmados

| # | Hallazgo | Dónde | Evidencia |
| --- | --- | --- | --- |
| H1 | **Desborde horizontal por el marcador del ICA.** El riel invisible `.escala-pista` mide lo mismo que la barra y se mueve con `translateX(%)`, así que se sale por la derecha tanto como avance el marcador. | `Ficha.jsx` (`EscalaIca`) y `.escala-pista` en `estilos.css`. Entró con 6b769bb. | En el celular la página pasa de 375 a 473 px al elegir una estación (ICA 110) y aparece scroll lateral. En escritorio el panel de 360 px se desplaza hasta 391 px con ICA 50 y hasta 500 px con ICA 155: cuanto peor el aire, mayor el desborde. Incumple WCAG 1.4.10, que la entrada del 26 de octubre daba por resuelto. |
| H2 | **Nombre encimado en la lista.** `.lista .estado` lleva `white-space: nowrap` y la columna del nombre es `minmax(0, 1fr)`. | `estilos.css`, regla `.lista .estado` | Con «Dañina a la salud de grupos sensibles», la columna del nombre queda en 0 px (pantalla de 320), 17 px (375) y 32 px (390), y el nombre se dibuja encima del estado. |
| H3 | **El selector de variable recorta el nombre.** La tarjeta mide 232 px (210 en el celular) y la API llama a los parámetros «Material particulado PM2.5» y «Material particulado PM10». | `.controles-mapa` y `SelectorParametro.jsx` | Cerrado muestra «Material particulado PM» en escritorio y «Material particulado» en el celular. PM2.5 y PM10 se ven iguales. |
| H4 | **Recharts va en la carga inicial.** `Ficha.jsx` lo importa de forma estática. | `dist/index.html` precarga `graficas-*.js` con `modulepreload` | Son 385 kB (102 kB con gzip) que solo se usan al abrir una estación con datos recientes o el Histórico. Hoy la carga inicial suma unos 440 kB de JavaScript comprimido, sin contar el proceso del mapa. |
| H5 | **Tablas de Administración en el celular.** `overflow-wrap: anywhere` parte cada celda. | `.tabla-auditoria td` | La IP sale en seis renglones, el correo partido y «rechazad / o». En la tabla de fuentes, la frecuencia, la activación y el botón de guardar quedan fuera de la vista sin nada que avise que hay scroll. |
| H6 | **Nada vive en la URL.** | `App.jsx` | Recargar o usar «Atrás» devuelve el mapa sin estación. No hay forma de compartir el enlace de una estación ni de una consulta del Histórico. |
| H7 | **La selección depende de un índice.** El `id` de cada grupo es su posición en la lista ordenada. | `agruparEstaciones` en `util.js` | Si una actualización de diez minutos trae una estación nueva, el índice elegido puede apuntar a otra. Por lo mismo no sirve como identificador en un enlace. |
| H8 | **El Histórico ofrece estaciones sin la variable.** | `Historico.jsx` | El selector lista todas las estaciones y fuentes, midan o no la variable elegida. |
| H9 | **El celular es una página muy larga.** | Vista del mapa a 375 px | Unos 3000 px: mapa, estado, alertas, ficha, la leyenda completa y, al final, la lista. |
| H10 | **Constantes del ICA repetidas.** | `COLORES_ICA` y `RANGOS_INDICE` en `Ficha.jsx`, `COLOR_SIN_ESCALA` en `Mapa.jsx` | Los colores ya llegan de `/api/umbrales` y el azul de la serie ya existe como `--serie`. Dos fuentes de verdad para lo mismo. |

A esto se suman tres pendientes del README y de la bitácora: pruebas de
extremo a extremo y de accesibilidad automática (incremento 2, RNF-07), probar
en un celular real y revisar el movimiento.

## 2. Skills, agentes y plugins

### Disponibles en la sesión, sin instalar nada

| Herramienta | Tipo | Para qué sirve aquí | Fase |
| --- | --- | --- | --- |
| `dataviz` | skill | Colores y marcas de las gráficas (Histórico, últimas 48 horas, comparación entre estaciones), escala del ICA y leyenda. El proyecto ya la usó para el color de la serie. | 4 y 5 |
| `run` | skill | Levantar el visor y ver un cambio funcionando. Con la API simulada de la fase 1 no necesita el backend. | todas |
| `code-review` | skill | Revisar el diff de cada fase antes de integrarlo. | todas |
| `simplify` | skill | Limpieza al cerrar cada fase: constantes repetidas, código que sobra. | 6 |
| `security-review` | skill | Revisar los parámetros de la URL (fase 3) y cualquier cambio en el inicio de sesión. | 3 |
| `Explore` | agente | Búsquedas de solo lectura: dónde se usa un color, qué componentes leen `seleccion`. | todas |
| `Plan` | agente | Diseñar antes de escribir código lo que tiene varias piezas: el estado en la URL o una hoja inferior en el celular. | 3 y 4 |
| `general-purpose` | agente | Auditorías en paralelo, un agente por pantalla con sus capturas. | 2 |
| Playwright 1.63 y su Chromium | preinstalados en el contenedor | Pruebas de extremo a extremo, axe-core y capturas. Con ellos se hizo esta auditoría. | 1 |

### Del catálogo de plugins

Se instalan desde claude.ai; hoy ninguno está activo en la cuenta. Estos son
los que encajan, de mayor a menor utilidad:

| Plugin | Publica | Skills útiles | Uso en PIMAU | Notas |
| --- | --- | --- | --- | --- |
| **Design** | Anthropic | `design-critique`, `accessibility-review`, `ux-copy`, `user-research`, `design-system` | Crítica de cada pantalla, accesibilidad de lo que axe no ve (orden de lectura, gráficas), textos de los avisos y guion para probar con usuarios. | Trae conectores (Figma, Slack, Notion…) que aquí no hacen falta. |
| **frontend-design** | Anthropic | `frontend-design` | Guía para implementar el rediseño de la ficha y del celular. | Empuja hacia estéticas llamativas: hay que darle la regla de que el color lo pone el ICA. |
| **VectorLab UI/UX Skills** | comunidad | `ux-audit`, `empty-states`, `loaders`, `errors`, `forms`, `keyboard`, `viewports`, `motion`, `reduced-motion`, `typography`, `spacing` | Listas de revisión puntuales. `motion` y `reduced-motion` cubren la revisión de movimiento pendiente. | No usa servidores externos. Al ser de la comunidad, conviene leer cada skill antes de usarla. |
| **Axe Accessibility** | Deque (socio) | `mcp-audit` y su servidor MCP | Escanear, corregir y volver a verificar en el mismo ciclo, con pruebas guiadas de teclado. | Usa un servidor remoto: revisar si pide cuenta. La alternativa gratuita es `axe-core` dentro de las pruebas (fase 1); otra local es **A11y Enforcer** (comunidad). |
| **Perf Profiler** | comunidad | `perf-profiler`, `/perf-audit` | Leer Lighthouse y Core Web Vitals; detectar renders de React de más. | No usa servidores externos. **Web Vitals Auditor** hace algo parecido, pero instala hooks en la sesión. |

### Revisados y descartados

- **Skills For Real React/React Native Engineers**: casi todo es React Native,
  GSAP, Tailwind y Next.js. Solo `ui-motion` y el agente `animation-specialist`
  tocan el tema, y el plugin pide permisos amplios.
- **doom-design-system**: es otra librería de componentes, de estética
  neubrutalista.
- **Mobile Design System**: solo sirve para apps nuevas.
- Migraciones de Vanilla JS, Backbone o Ember a React: no aplican.

La bitácora menciona `review-animations` y las guías de interfaz de Apple. No
están en el catálogo de esta sesión; si siguen en el equipo donde se hizo esa
revisión, sirven igual para la fase 2.

## 3. Fases

### Fase 0. Arreglos confirmados (alrededor de 1 día)

Cerrar H1 a H5 antes de construir encima.

1. **H1, marcador del ICA.** Quitar el riel de ancho completo y mover solo el
   marcador. Con unidades de contenedor se sigue animando con `transform`:

   ```css
   .escala-barra { container-type: inline-size; }
   .escala-marcador { transform: translateX(calc(var(--posicion) * 1cqi));
                      transition: transform 240ms var(--curva-mover); }
   ```

   con `style={{ "--posicion": porcentaje }}` en el marcador, y la regla de
   «reducir movimiento» pasada a `.escala-marcador`. Lo mínimo, si se prefiere:
   `overflow-x: clip` en `.escala`.
2. **H2, lista.** Por debajo de unos 480 px, el estado baja a un segundo
   renglón bajo el nombre (`grid-template-areas`), sin `nowrap`.
3. **H3, selector.** En el mapa, el selector muestra el nombre corto
   (`nombreCorto`: PM2.5, PM10, O₃…). El nombre completo ya está en la leyenda y
   en la ficha. `SelectorParametro` recibe una opción para eso y el Histórico
   sigue con el nombre largo.
4. **H4, carga diferida.** `React.lazy` para `Historico`, `Administracion` y la
   gráfica de 48 horas (que pasa a su propio archivo; `PuntoAnomalo`, a un
   módulo compartido). Comprobar que `dist/index.html` ya no precarga
   `graficas-*.js`.
5. **H5, Administración en el celular.** Fecha, IP y resultado sin partir
   (`white-space: nowrap`) dentro del scroll de la tabla, con un degradado en
   el borde que avise que hay más. La otra opción: filas como tarjetas por
   debajo de 640 px.

**Herramientas:** `run` y `code-review`.
**Listo cuando:** a 320 y 375 px la página mide lo mismo que la ventana con
cualquier ICA, el panel de escritorio no se desplaza de lado y la carga inicial
baja unos 100 kB comprimidos.

### Fase 1. Pruebas de extremo a extremo y de accesibilidad (1 a 2 días)

Que H1 y H2 no vuelvan, y cerrar el pendiente del README y de RNF-07.

- `@playwright/test` fijo en 1.63.0 en `web/`, la misma versión del contenedor
  (así usa el Chromium de `/opt/pw-browsers` sin descargar otro).
- Una API simulada en `web/e2e/`: fixtures JSON con la forma de `esquemas.py` y
  `page.route` para `/api/*`. Los casos de `src/desarrollo/casos.js` (peor,
  vacío y error) pasan a ser fixtures.
- El mapa base se intercepta con un estilo mínimo, como en esta auditoría, para
  no depender de OpenFreeMap en CI:

  ```js
  await context.route("https://tiles.openfreemap.org/**", (route) =>
    route.request().url().includes("/styles/")
      ? route.fulfill({ json: { version: 8, sources: {},
          glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
          layers: [{ id: "background", type: "background",
                     paint: { "background-color": "#f3f5f4" } }] } })
      : route.fulfill({ status: 200, body: Buffer.alloc(0) }));
  ```

  Sin `glyphs`, MapLibre no acepta las capas con texto. Para que WebGL funcione
  sin GPU, Chromium se lanza con `--use-angle=swiftshader`.
- Pruebas:
  - **Accesibilidad:** axe sin violaciones (`wcag2a`, `wcag2aa`, `wcag21aa`,
    `wcag22aa`) en cada pestaña, claro y oscuro, con y sin ficha, y en los
    casos extremos.
  - **Reflujo:** `scrollWidth` igual al ancho de la ventana a 320, 375 y
    768 px, con una ficha de ICA 500 (H1) y la categoría más larga en la lista
    (H2).
  - **Flujos:** elegir una estación con el teclado y que el foco pase a
    `#titulo-ficha`; consultar el Histórico y abrir la tabla; guardar una fila
    en Administración sin perder el foco.
  - **Capturas** de cada vista como artefacto de CI, para revisarlas a ojo. La
    comparación píxel a píxel puede venir después, con `.mapa` enmascarado.
- Job `e2e` en `.github/workflows/ci.yml`, después de `web`
  (`npx playwright install --with-deps chromium`).

**Herramientas:** Playwright y `axe-core` (o el plugin Axe), `run`,
`code-review`.
**Listo cuando:** el job corre en cada PR y falla si se reintroduce H1 o H2.

### Fase 2. Auditoría guiada (1 día)

Una lista priorizada de mejoras con evidencia, más allá de lo que mide axe.

- Entrada: las capturas de la fase 1 (escritorio y celular, claro y oscuro,
  casos extremos).
- Cuatro agentes `general-purpose` en paralelo, uno por pantalla: mapa y ficha
  en escritorio, mapa y ficha en el celular, Histórico y Administración. Cada
  uno aplica `design-critique` y `accessibility-review` (Design) más las listas
  de VectorLab que le toquen (`empty-states`, `loaders`, `errors`, `forms`,
  `viewports`, `keyboard`). Devuelve hallazgos con severidad, captura y arreglo
  propuesto.
- `ux-copy` sobre los textos largos: avisos de la ficha, leyenda y notas del
  Histórico. Varios avisos son párrafos de tres o cuatro líneas que podrían
  quedar en una línea y un «¿Qué significa?» desplegable.
- `motion` y `reduced-motion` sobre lo que se mueve hoy: el fundido de la
  ficha, el marcador del ICA, la respuesta de los botones, la fila guardada y
  el desplazamiento del mapa al elegir una estación. Con eso se cierra el
  pendiente de la bitácora.
- Prueba a mano en celulares reales (Safari en iOS, Chrome en Android): barra
  del navegador, teclado sobre los campos de fecha y de umbral, zoom, gesto de
  dos dedos en el mapa, modo oscuro, y la lista y la ficha con VoiceOver y
  TalkBack.

**Salida:** los hallazgos se suman a este plan (o como issues, si el equipo lo
prefiere) y ajustan las fases 3 a 5.

### Fase 3. Estado en la URL y búsqueda (2 a 3 días)

Que un enlace abra la misma vista, que «Atrás» funcione y que encontrar una
estación no obligue a recorrer la lista.

- Un identificador estable para cada grupo de estaciones en lugar del índice.
  La clave normalizada que ya calcula `claveEstacion` sirve. Resuelve H7.
- Un hook `useEstadoEnUrl` con `URLSearchParams`: `vista`, `estacion`,
  `variable`, `vigencia` y, en el Histórico, `desde` y `hasta`. `pushState` al
  cambiar de pestaña o de estación, `replaceState` para lo demás y un oyente de
  `popstate`. Como son parámetros sobre `/`, la configuración de nginx no
  cambia.
- Botón «Copiar enlace» en la ficha, con la confirmación en un `role="status"`.
- Campo de búsqueda sobre la lista (sin tildes ni mayúsculas, con
  `claveEstacion`) que anuncie cuántas estaciones quedan.
- Enlace «Saltar a la lista de estaciones» al comienzo de la página.

**Herramientas:** agente `Plan` para diseñar el hook y sus pruebas;
`security-review` (los parámetros solo eligen entre valores conocidos y nunca
se insertan como HTML); pruebas de la fase 1 para el enlace directo y «Atrás».

### Fase 4. Ficha y celular (3 a 4 días)

Que la ficha responda primero «¿cómo está el aire aquí?» y que el celular deje
de ser una página de 3000 px.

- **Jerarquía de la ficha.** Hoy va primero la concentración horaria, luego
  los avisos y después la categoría del ICA. Probar el orden contrario:
  categoría con su color y su índice, una línea sobre qué significa, y después
  el valor horario y los avisos. Una recomendación por categoría solo entra si
  sale de una fuente oficial citada. Las dos fechas (la del valor horario y la
  del promedio del ICA) siguen a la vista.
- **Avisos.** Título y una línea; el detalle, desplegable (sale de `ux-copy` en
  la fase 2).
- **Gráfica de 48 horas.** Referencias de tiempo en los extremos («hace 48 h»,
  «ahora») para leerla sin pasar el puntero (`dataviz`).
- **Celular, primer paso.** Reordenar el panel: estado, alertas, ficha, lista y
  la leyenda plegada en un `<details>`. Medir con las pruebas de la fase 1 el
  alto de la página y cuánto hay que desplazarse hasta la ficha.
- **Celular, segundo paso** (si el primero no alcanza). La ficha en una hoja
  inferior sobre el mapa. Exige manejar el foco, los gestos y una alternativa
  con teclado, así que se diseña antes con el agente `Plan` y se prueba con
  usuarios.
- **Prueba con 5 personas** ajenas al proyecto, con un guion de `user-research`
  (Design) y tres tareas: ver cómo está el aire cerca de una universidad, saber
  si hoy hubo alertas y descargar los datos de octubre de una estación.

**Herramientas:** `frontend-design` (con la regla de que el color lo pone el
ICA), VectorLab (`surfaces`, `spacing`, `typography`), `dataviz`, `Plan`.

### Fase 5. Histórico (2 a 3 días)

- El selector de estación ofrece solo las que miden la variable elegida (H8),
  o muestra las demás deshabilitadas con «sin datos de PM2.5».
- Atajos de periodo (7 días, 30 días, 1 año, todo) que consultan de una vez.
  El rango libre sigue con «Consultar».
- «Hay datos del… al…» dentro de la tarjeta de filtros, junto a las fechas.
- Comparar dos estaciones, o las dos fuentes de una misma estación, en una sola
  gráfica, con colores validados con `dataviz` y sin repetir los del ICA.
- Acercar un tramo con el `Brush` de Recharts.

**Herramientas:** `dataviz`, `frontend-design` y las pruebas de la fase 1.

### Fase 6. Rendimiento y mantenimiento (1 a 2 días)

- Lighthouse sobre el build (con el Chromium del contenedor) y un presupuesto
  de tamaño en CI para que la carga inicial no vuelva a crecer. Perf Profiler
  ayuda a leer los resultados.
- Un módulo `web/src/ica.js` con los rangos y los colores del ICA, o tomarlos
  de `/api/umbrales`, que ya los entrega (H10). `COLOR_SIN_ESCALA` pasa a leer
  `--serie`.
- `simplify` sobre lo que dejen las fases anteriores.

## 4. Orden

```
Fase 0 ─► Fase 1 ─► Fase 2 ─┬─► Fase 3 ─► Fase 4
                            └─► Fase 5
Fase 6 al final, o en paralelo con la 5
```

Entre 11 y 16 días de trabajo en total (estimado). Cada fase cierra igual: las
pruebas de la fase 1 en verde, `code-review` sobre el diff y una entrada en la
bitácora con lo que se midió.

## 5. Lo que no cambia

- Los colores del ICA son los de la Resolución 2254 de 2017 y la categoría
  siempre va con su nombre.
- La meta de accesibilidad es WCAG 2.2 AA (RNF-07).
- El modo oscuro sigue al sistema, sin interruptor propio (decisión del
  2026-10-26).
- Mapa base gratuito y sin clave.
- Ningún texto normativo o de salud entra sin fuente oficial citada.
- La interfaz no cambia lo que muestran los datos. Si un cambio lo exige, se
  registra primero en la bitácora.

## 6. Ideas para más adelante

Quedan fuera de este plan: guardar una estación favorita en el navegador,
avisar con una notificación cuando esa estación tenga una alerta, instalar el
visor como app (PWA) y descargar la gráfica del Histórico como imagen.
