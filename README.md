# Selector de celdas y checkboxes

Extensión para Google Chrome que reúne dos funciones en una:

- **Celdas, como en Firefox:** Ctrl + clic izquierdo + arrastrar → seleccionar celdas → Ctrl + C → pegar en Excel.
- **Checkboxes:** Shift + clic derecho + arrastrar → dibujar una caja → se alternan las casillas que quedan dentro.

Funciona sola al entrar en cualquier página, sin botones, menús ni ventanas emergentes.

## Instalación

1. **Quita de Chrome las versiones anteriores** (Selector de celdas y Checkbox Selector), para que no actúen a la vez que esta.
2. Descomprime `selector-celdas-extension.zip` en una carpeta que vayas a conservar (o usa directamente la carpeta `extension/`).
3. Abre `chrome://extensions`.
4. Activa **Modo de desarrollador** (arriba a la derecha).
5. Pulsa **Cargar descomprimida** y elige la carpeta que contiene `manifest.json`.
6. Recarga las pestañas que ya tuvieras abiertas: la extensión solo actúa en las páginas cargadas después de instalarla.

Para usarla en archivos locales (`file://`), entra en **Detalles** de la extensión y activa **Permitir el acceso a URLs de archivo**.

## Uso de los checkboxes

Mantén pulsada Shift, pulsa el botón derecho y arrastra. Cada casilla cuyo centro entre en la caja cambia de estado una sola vez por arrastre: las marcadas se desmarcan y al revés. Durante el arrastre no aparece el menú contextual.

Respecto a la extensión original (Checkbox Selector 1.5), se mantienen el atajo y la lógica de selección, con estos cambios:

- **La página se entera del cambio.** Se usa `click()`, que lanza `click`, `input` y `change`. Antes, una web con JavaScript podía no detectar la casilla marcada. También significa que, si la página rechaza el clic, la casilla no cambia.
- **Se omiten las casillas desactivadas y ocultas**, que antes podían cambiar sin que se vieran.
- **El menú contextual solo se bloquea durante el arrastre.** Shift + F10 vuelve a funcionar y soltar Shift antes que el ratón ya no abre el menú.
- **Funciona dentro de iframes**, dentro del marco donde empieza el arrastre.
- **La caja se dibuja bien** aunque la página tenga estilos que antes la desplazaran, y sigue anclada si se desplaza la página.
- **Si se suelta el botón fuera de la ventana**, la caja se cierra al volver con el ratón.

## Uso de las celdas

| Acción | Resultado |
|---|---|
| Ctrl + arrastrar sobre celdas | Selecciona una columna, una fila o un bloque |
| Ctrl + clic en una celda | Selecciona esa celda; repetirlo la deselecciona |
| Ctrl + C | Copia la selección como texto y como tabla HTML |
| Escape | Cancela la selección, también a mitad de un arrastre |
| Clic normal en cualquier parte | Cancela la selección |
| Llevar el cursor al borde durante el arrastre | Desplaza la página o el contenedor para seguir seleccionando |

La celda inicial se marca con borde azul y la final con borde naranja. Un arrastre nuevo sustituye a la selección anterior.

Ctrl + clic **sobre un enlace** sigue abriéndolo en otra pestaña, como siempre. Para seleccionar una celda que solo contiene un enlace, haz un arrastre corto dentro de ella.

## Permisos y privacidad

- **No solicita ningún permiso de API** (`permissions` no aparece en el manifiesto). El portapapeles se escribe dentro del gesto de Ctrl + C, lo que no requiere permiso.
- **Sí necesita acceso a todos los sitios** (`<all_urls>`), porque debe actuar en cualquier página con tablas. Por eso Chrome avisa de que puede «leer y cambiar tus datos en todos los sitios web». Si prefieres limitarlo, en **Detalles → Acceso al sitio** puedes elegir solo ciertos sitios o «al hacer clic».
- **No envía datos a ningún sitio.** El código no hace peticiones de red, no guarda nada y no tiene servicio en segundo plano.
- Chrome no permite que actúe en `chrome://`, en la Chrome Web Store ni en su visor de PDF.

## Cómo funciona

Son dos scripts sin dependencias que se inyectan en cada página y marco: `content.js` (celdas) y `checkboxes.js` (casillas). No comparten estado y no se interfieren: cada uno responde a una combinación distinta de botón y tecla, y si ya hay un arrastre en curso con el otro botón, no se inicia un segundo. `checkboxes.js` dibuja una caja con coordenadas de página y, en cada fotograma en que algo cambia, comprueba las casillas contra ella.

Lo siguiente describe `content.js`:

- **Antes que la página.** Se registra en `document_start`, en fase de captura sobre `window`. Sus manejadores se ejecutan primero, así que puede impedir que la página interfiera, y solo lo hace mientras dura un Ctrl + arrastre o al copiar una selección suya.
- **Selección propia, no nativa.** No usa la selección de texto del navegador; por eso `user-select: none` no le afecta y no se selecciona texto fuera de la tabla. Las celdas se marcan con un atributo `data-cellsel`, que resiste a las páginas que reescriben `className`.
- **Rejilla lógica.** Convierte la tabla en una matriz que resuelve `rowspan`, `colspan` y filas o celdas ocultas. La selección se guarda como un rectángulo de esa matriz.
- **Celda bajo el cursor por geometría.** La fila se busca por posición (búsqueda binaria) y la columna midiendo sus celdas. Así funciona con `pointer-events: none`, con la captura de puntero y cuando el cursor sale de la tabla.
- **Copia.** Al pulsar Ctrl + C lanza `document.execCommand('copy')` y rellena `text/plain` y `text/html` en el evento `copy`. Funciona también en páginas `http` sin `navigator.clipboard`, que queda como alternativa si lo anterior falla.
- **Tablas dinámicas.** Mientras hay selección, un `MutationObserver` recalcula la rejilla y reaplica el resaltado. Al copiar siempre se lee el contenido actual.

El coste en reposo es mínimo: sin Ctrl pulsado, los manejadores salen en la primera comprobación. El resaltado aplica solo las diferencias entre un fotograma y el siguiente.

### Formato copiado

- **Celdas combinadas.** Se recortan al rectángulo seleccionado: arrastrar por una columna nunca añade columnas aunque una fila tenga `colspan`. Si el arrastre *empieza* en una celda combinada, se incluye toda su extensión.
- **Texto.** Se obtiene con `innerText` (lo visible). Los saltos de línea internos pasan a ser espacios para no partir la fila, y los espacios duros (`&nbsp;`) pasan a espacios normales.
- **Fórmulas.** Un texto como `=1+1` se marca como texto en el HTML para que Excel no lo evalúe: se pega tal como se ve en la página. Evita además que una web pueda colarte fórmulas. Números como `-5` siguen siendo números.

## Pruebas ejecutadas

Última ejecución: 4 de noviembre de 2026, en Windows 11, con la extensión **descomprimida del ZIP final** e instalada de verdad en el navegador.

| Entorno | Resultado |
|---|---|
| Google Chrome 157 (headless) | 101 de 101 |
| Chromium 156 (headless) | 101 de 101 |
| Chromium 156 con ventana y portapapeles real de Windows | 101 de 101 |
| Pegado en Excel 16 real | 11 de 11 |

Los resultados detallados de la última ejecución están en `tests/resultados/`.

| Bloque | Qué se comprueba |
|---|---|
| Las 8 tablas pedidas | Una columna, dos columnas, 10 filas con enlaces, texto anidado, `user-select: none`, `rowspan`/`colspan`, dinámica y hostil |
| Selección | Vertical, horizontal, bloques, arrastre inverso, resaltado visible, marcas de inicio y final, la selección permanece al soltar |
| Copia | Texto e HTML exactos, una columna no añade columnas, escapado de HTML, sin elementos ocultos ni decorativos, pegado real en un campo |
| Cancelación | Escape (también durante el arrastre), clic fuera y dentro, entrar en un campo, selección nativa posterior |
| Página hostil | `preventDefault` y `stopImmediatePropagation` en todos los eventos, captura de puntero, filas `draggable`, bloqueo de `copy` y de Ctrl + C, `pointer-events: none` en celdas y en tabla |
| Robustez | Cursor fuera de la tabla, soltar Ctrl a mitad, `mouseup` perdido, pérdida de foco, autodesplazamiento, clic en barra de desplazamiento y clic derecho |
| Sin interferencias | Clics, enlaces, Ctrl + clic en enlaces, selección nativa y Ctrl + C nativo, campos y controles, Escape, otras combinaciones de teclas |
| Otros contextos | Tablas anidadas, Shadow DOM abierto, iframe, filas y columnas ocultas, página `http` no segura |
| Control | Sin la extensión, Ctrl + arrastrar no selecciona nada (las pruebas detectan su ausencia) |
| Rendimiento | Tabla de 5000 × 10: marcar una columna completa tarda 22–30 ms y Ctrl + C, 137–399 ms. 5000 casillas: el arrastre completo tarda unos 350 ms |
| Excel | Una columna, bloque, enlaces, celdas combinadas, símbolos, números, fórmulas y pegado como texto |
| Checkboxes | Alternado dentro de la caja, sentido inverso, una vez por arrastre, eventos y formularios, desactivadas y ocultas, caja visible y bien situada, página desplazada, iframe, página hostil, `mouseup` perdido |
| Menú contextual | Bloqueado durante el arrastre, también al soltar Shift antes; clic derecho normal y Shift + F10 intactos |
| Convivencia | La caja no borra la selección de celdas ni la crea; Ctrl + arrastrar no alterna casillas; pulsar los dos atajos a la vez no rompe ninguno |
| Migración | El ZIP original y esta versión producen el mismo estado de casillas en un mismo escenario, y solo esta avisa a la página |

Todas las pruebas de `pruebas.html` fallan además si aparece cualquier error o aviso en la consola.

**Errores que encontraron las pruebas y se corrigieron:**

1. La página podía detener el arrastre: los manejadores de `mousemove` y `mouseup` se añadían al pulsar y quedaban detrás de los suyos.
2. Si se eliminaba una tabla, la selección podía saltar a otra tabla distinta.
3. `=1+1` se pegaba en Excel como fórmula y se evaluaba.
4. Perder el foco cortaba el arrastre.

**Sobre las pruebas con ventana:** pueden fallar de forma ocasional, por lo que tienen un reintento permitido (la última ejecución no lo necesitó). Una traza de eventos de un fallo anterior mostró la causa: el cursor físico de Windows se mezcla con el ratón simulado, con movimientos sin botón y coordenadas ajenas al arrastre. Otros fallos ocasionales con ventana tuvieron síntomas parecidos, pero no se trazaron uno a uno. En headless no hay reintentos.

### Qué no se ha probado

- **Uso con un ratón físico.** Los eventos son reales para el navegador, pero los genera Playwright.
- **El botón «Cargar descomprimida».** La instalación se hizo con `--load-extension` y, en Chrome, con `Extensions.loadUnpacked`, que usan el mismo cargador de extensiones sin paquete.
- **Chrome con ventana.** Chrome se probó en headless; las pruebas con ventana y las de Excel se hicieron en Chromium.
- **Ctrl + V en Excel.** El pegado se hizo por automatización (`Worksheet.Paste`, en una instancia oculta).
- **Webs reales.** Solo se han usado las páginas de prueba de este proyecto.
- **macOS y Linux.** El código usa ⌘ en lugar de Ctrl en Mac, pero no se ha ejecutado allí.
- **Encabezados `sticky`.** Hay código para ellos, sin prueba específica.
- **La vía alternativa de copia.** `navigator.clipboard` solo se usa si `execCommand('copy')` falla, cosa que no ha ocurrido en ninguna prueba.
- **Firefox.** Esta versión está pensada y probada para Chrome. El ZIP original era para Firefox y la versión combinada no se ha ejecutado allí.

### Repetir las pruebas

```
cd tests
npm install
npx playwright install chromium
npm test
```

Otras variantes, con la sintaxis de PowerShell:

```
$env:BROWSER_CHANNEL='chrome'; npm test     # en Google Chrome
$env:HEADED='1'; npm test                   # con ventana y portapapeles real
npm run test:excel                          # pegado en Excel (requiere Excel para Windows)
```

Las variantes con ventana y Excel **sobrescriben el portapapeles** y conviene no mover el ratón mientras se ejecutan. Excel se abre en una instancia oculta aparte, sin tocar tus libros abiertos ni guardar nada.

## Limitaciones conocidas

**Diferencias con Firefox**

- Solo hay una selección rectangular. Firefox permite acumular varias con Ctrl; aquí cada arrastre sustituye al anterior, como pedía la especificación.

**Tipos de tabla**

- Solo funciona con tablas HTML reales (`<table>`). Las cuadrículas hechas con `<div>` o `role="grid"` (habituales en algunas aplicaciones web) no son compatibles.
- En tablas virtualizadas, que solo mantienen en el DOM las filas visibles, únicamente se puede seleccionar lo que exista en ese momento.
- No funciona dentro de Shadow DOM cerrado.

**Aplicaciones con funciones propias de Ctrl**

- Mientras dura un Ctrl + pulsación en una celda, la página no recibe ese `mousedown` y `mouseup` (sí el `click` si no hubo arrastre). Una aplicación que use Ctrl + clic con esos eventos para sus propias funciones, como marcar varias filas, puede dejar de responder en las celdas. Si te ocurre en un sitio, quítalo en **Acceso al sitio**.

**Tablas dinámicas**

- La selección conserva la *posición* (fila y columna), no el dato. Si la página inserta filas por arriba, el resaltado se queda en su sitio y muestra otros datos. Lo que se copia siempre coincide con lo resaltado.
- Si la página sustituye la tabla entera, se reasocia solo si no cambian el número de tablas de la página ni el de columnas; si no, la selección se cancela.

**Excel**

- Excel interpreta los datos al pegar según su configuración regional, y la extensión no lo modifica. Comprobado: `00123` pasa a `123`, `1/2` pasa a fecha (`01-feb`) y `1.234,50` pasa a número.
- La protección contra fórmulas solo actúa en el pegado normal, que usa el HTML. Con **Pegado especial → Texto**, `=1+1` sí se evalúa y Excel quita las comillas de `"entre comillas"`.
- Las celdas `<th>` se copian como tales, por lo que Excel puede aplicarles su formato de encabezado.

**Texto**

- `innerText` no incluye el texto alternativo de las imágenes, y puede incluir texto oculto solo visualmente (para lectores de pantalla) en las páginas que lo usen.

**Marcos**

- Cada iframe gestiona su selección por separado, así que puede haber una selección visible en dos marcos a la vez. Ctrl + C copia la del marco que tiene el foco.

**Checkboxes**

- Solo reconoce `<input type="checkbox">` real y visible. No sirven las casillas hechas con `<div>` o `role="checkbox"`, ni las que ocultan el `<input>` con `display: none` y dibujan otra cosa encima. Tampoco las que están dentro de Shadow DOM.
- Si la caja incluye una casilla de «seleccionar todas», la página reacciona como con clics reales: esa casilla marca todas y las siguientes se alternan, de modo que pueden acabar desmarcadas. Conviene dejarla fuera de la caja.
- Si la página vuelve a crear las casillas al hacer clic, las nuevas cuentan como casillas distintas y podrían alternarse otra vez en el mismo arrastre.
- La caja no desplaza la página sola al llegar al borde, pero puedes usar la rueda del ratón durante el arrastre.
- Escape no cancela la caja; las casillas ya alternadas se quedan así.

## Estructura

```
extension/                       La extensión (manifest.json, content.js, checkboxes.js, content.css, icon.png)
selector-celdas-extension.zip    La misma carpeta, lista para descomprimir e instalar
tests/
  pages/                         Páginas de prueba (pruebas.html, checkboxes.html, rendimiento.html, otra.html)
  specs/                         Pruebas de Playwright
  helpers.js                     Arranque del navegador, ratón y lectura del portapapeles
  excel-pegar.ps1                Pegado real en Excel
  resultados/                    Resultados de la última ejecución
```
