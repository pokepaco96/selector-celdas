// Selector de celdas: Ctrl + arrastrar sobre una tabla selecciona un bloque de
// celdas y Ctrl + C lo copia como text/plain y text/html.
//
// Se registra en document_start y en fase de captura sobre window, de modo que
// estos manejadores se ejecutan antes que los de la página. Mientras no se pulsa
// Ctrl y no hay selección activa, no se cancela ni se detiene ningún evento.
(() => {
  'use strict';

  const ATTR = 'data-cellsel';
  const DRAG_ATTR = 'data-cellsel-drag';
  const DRAG_THRESHOLD = 4; // px antes de considerar que un clic es un arrastre
  const SCROLL_EDGE = 28; // px desde el borde en los que empieza el autodesplazamiento
  const SCROLL_MAX_SPEED = 30; // px por fotograma
  const IS_MAC = /Mac/i.test(navigator.platform);
  // Texto que Excel evaluaría como fórmula al pegarlo; los números con signo no cuentan.
  const FORMULA_LIKE = /^(=|@|[+-](?!\s*[\d.,]+\s*%?$))/;

  // content.css no atraviesa los límites de Shadow DOM.
  const SHADOW_CSS = `
    td[${ATTR}],th[${ATTR}]{background-color:rgba(66,133,244,.3)!important;background-image:none!important;box-shadow:inset 0 0 0 1px rgba(26,86,196,.55)!important}
    td[${ATTR}] *,th[${ATTR}] *{background-color:transparent!important}
    td[${ATTR}~="start"],th[${ATTR}~="start"]{box-shadow:inset 0 0 0 2px #1a56c4!important}
    td[${ATTR}~="end"],th[${ATTR}~="end"]{box-shadow:inset 0 0 0 2px #c2410c!important}
    td[${ATTR}="start end"],th[${ATTR}="start end"]{box-shadow:inset 0 0 0 2px #1a56c4!important}`;

  let selection = null; // { table, root, tableIndex, tableCount, grid, anchor, focus, marks, observer }
  let press = null; // { cell, table, onLink, startX, startY, x, y, dragging, scroller, scrollPaused }
  let suppressClick = false;
  let copyPayload = null;
  let copyHandled = false;
  let rafId = 0;
  let refreshQueued = false;

  // ---------------------------------------------------------------------------
  // Rejilla lógica de la tabla (resuelve rowspan, colspan y elementos ocultos)
  // ---------------------------------------------------------------------------

  function buildGrid(table) {
    const allRows = table.rows;
    const total = allRows.length;
    const raw = Array.from({ length: total }, () => []);
    const hidden = new Array(total).fill(false);
    const spanEnd = []; // última fila ocupada en cada columna
    let sectionEnd = -1;

    for (let r = 0; r < total; r++) {
      const row = allRows[r];
      if (r > sectionEnd) {
        sectionEnd = r;
        while (sectionEnd + 1 < total && allRows[sectionEnd + 1].parentNode === row.parentNode) {
          sectionEnd++;
        }
      }
      if (row.getClientRects().length === 0) {
        hidden[r] = true;
        continue;
      }
      let c = 0;
      for (const cell of row.cells) {
        if (cell.getClientRects().length === 0) continue;
        while (spanEnd[c] >= r) c++;
        const end = cell.rowSpan === 0 ? sectionEnd : Math.min(r + cell.rowSpan - 1, sectionEnd);
        for (let cc = c; cc < c + cell.colSpan; cc++) {
          spanEnd[cc] = end;
          for (let rr = r; rr <= end; rr++) raw[rr][cc] = cell;
        }
        c += cell.colSpan;
      }
    }

    const matrix = [];
    const rows = [];
    for (let r = 0; r < total; r++) {
      if (hidden[r] || raw[r].length === 0) continue;
      matrix.push(raw[r]);
      rows.push(allRows[r]);
    }

    const info = new Map(); // celda -> extensión lógica { r0, c0, r1, c1 }
    let colCount = 0;
    for (let r = 0; r < matrix.length; r++) {
      const line = matrix[r];
      colCount = Math.max(colCount, line.length);
      for (let c = 0; c < line.length; c++) {
        const cell = line[c];
        if (!cell) continue;
        const extent = info.get(cell);
        if (!extent) {
          info.set(cell, { r0: r, c0: c, r1: r, c1: c });
        } else {
          extent.r1 = Math.max(extent.r1, r);
          extent.c1 = Math.max(extent.c1, c);
        }
      }
    }

    // Filas de cabecera y pie aparte: si son sticky, sus posiciones no son
    // monótonas respecto al cuerpo y romperían la búsqueda binaria.
    let fixed = [];
    let main = [];
    rows.forEach((row, i) => {
      const section = row.parentNode.localName;
      (section === 'thead' || section === 'tfoot' ? fixed : main).push(i);
    });
    if (main.length === 0) {
      main = fixed;
      fixed = [];
    }

    return { matrix, rows, info, colCount, fixed, main, colRefs: buildColRefs(matrix, info, colCount) };
  }

  // Para cada columna, una celda de referencia con la que medirla en vivo.
  function buildColRefs(matrix, info, colCount) {
    const refs = new Array(colCount);
    let missing = colCount;
    for (let r = 0; r < matrix.length && missing > 0; r++) {
      for (let c = 0; c < colCount; c++) {
        const cell = matrix[r][c];
        if (refs[c] || !cell) continue;
        const { c0, c1 } = info.get(cell);
        if (c0 === c1) {
          refs[c] = { cell, index: 0, span: 1 };
          missing--;
        }
      }
    }
    if (missing > 0) {
      // Columnas que solo existen dentro de celdas combinadas.
      for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < colCount; c++) {
          const cell = matrix[r][c];
          if (refs[c] || !cell) continue;
          const { c0, c1 } = info.get(cell);
          refs[c] = { cell, index: c - c0, span: c1 - c0 + 1 };
        }
      }
    }
    return refs;
  }

  function rowAtY(grid, y) {
    const { rows, fixed, main } = grid;
    const last = rows.length - 1;
    for (const i of fixed) {
      const rect = rows[i].getBoundingClientRect();
      if (y >= rect.top && y < rect.bottom) return i;
    }
    const first = main[0];
    const end = main[main.length - 1];
    if (y < rows[first].getBoundingClientRect().top) {
      return y < rows[0].getBoundingClientRect().top ? 0 : first;
    }
    if (y >= rows[end].getBoundingClientRect().bottom) {
      return y >= rows[last].getBoundingClientRect().bottom ? last : end;
    }
    let lo = 0;
    let hi = main.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[main[mid]].getBoundingClientRect().bottom > y) hi = mid;
      else lo = mid + 1;
    }
    return main[lo];
  }

  // Búsqueda lineal: hay pocas columnas y así se admiten tablas RTL.
  function colAtX(grid, x) {
    let best = 0;
    let bestDistance = Infinity;
    for (let c = 0; c < grid.colCount; c++) {
      const ref = grid.colRefs[c];
      if (!ref) continue;
      const rect = ref.cell.getBoundingClientRect();
      const width = rect.width / ref.span;
      const left = rect.left + width * ref.index;
      const right = left + width;
      const distance = x < left ? left - x : x > right ? x - right : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = c;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Selección y resaltado
  // ---------------------------------------------------------------------------

  function createSelection(table, grid, anchor, focus) {
    const root = table.getRootNode();
    const tables = root.querySelectorAll('table');
    selection = {
      table,
      root,
      tableIndex: Array.prototype.indexOf.call(tables, table),
      tableCount: tables.length,
      grid,
      anchor,
      focus,
      marks: new Map(),
      observer: new MutationObserver(onMutations),
    };
    selection.observer.observe(root, { childList: true, subtree: true });
    injectShadowStyle(root);
    releaseNativeState();
    paint();
  }

  function clearSelection() {
    if (!selection) return;
    selection.observer.disconnect();
    for (const cell of selection.marks.keys()) cell.removeAttribute(ATTR);
    selection = null;
  }

  function selectionRect() {
    const { anchor, focus, grid } = selection;
    const maxR = grid.matrix.length - 1;
    const maxC = grid.colCount - 1;
    return {
      r0: Math.min(anchor.r0, focus.r, maxR),
      r1: Math.min(Math.max(anchor.r1, focus.r), maxR),
      c0: Math.min(anchor.c0, focus.c, maxC),
      c1: Math.min(Math.max(anchor.c1, focus.c), maxC),
    };
  }

  // Aplica solo las diferencias para que el arrastre no degrade tablas grandes.
  function paint() {
    const { grid, anchor, focus, marks } = selection;
    const { r0, r1, c0, c1 } = selectionRect();
    const next = new Map();
    for (let r = r0; r <= r1; r++) {
      const line = grid.matrix[r];
      for (let c = c0; c <= c1; c++) {
        if (line[c]) next.set(line[c], 'on');
      }
    }
    const startCell = grid.matrix[Math.min(anchor.r0, grid.matrix.length - 1)][anchor.c0];
    const endCell = grid.matrix[Math.min(focus.r, grid.matrix.length - 1)][focus.c];
    if (startCell && next.has(startCell)) next.set(startCell, 'start');
    if (endCell && next.has(endCell)) next.set(endCell, endCell === startCell ? 'start end' : 'end');

    for (const cell of marks.keys()) {
      if (!next.has(cell)) cell.removeAttribute(ATTR);
    }
    for (const [cell, value] of next) {
      if (marks.get(cell) !== value || !cell.hasAttribute(ATTR)) cell.setAttribute(ATTR, value);
    }
    selection.marks = next;
  }

  function injectShadowStyle(root) {
    if (!(root instanceof ShadowRoot) || root.querySelector('style[data-cellsel-style]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-cellsel-style', '');
    style.textContent = SHADOW_CSS;
    root.appendChild(style);
  }

  // Sin el foco en este marco, ni en un campo de texto, Ctrl + C llegaría a otro destino.
  function releaseNativeState() {
    window.getSelection()?.removeAllRanges();
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (active && isEditable(active)) active.blur();
    window.focus();
  }

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    return /^(input|textarea|select)$/.test(el.localName) || el.isContentEditable || document.designMode === 'on';
  }

  // ---------------------------------------------------------------------------
  // Tablas dinámicas
  // ---------------------------------------------------------------------------

  function onMutations(mutations) {
    if (!selection || refreshQueued) return;
    const { table } = selection;
    if (table.isConnected && !mutations.some((m) => table.contains(m.target))) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      refreshSelection();
    });
  }

  // Vuelve a calcular la rejilla manteniendo las mismas coordenadas lógicas.
  function refreshSelection() {
    if (!selection) return false;
    if (!selection.table.isConnected && !rebindTable()) {
      clearSelection();
      return false;
    }
    selection.grid = buildGrid(selection.table);
    if (selection.grid.matrix.length === 0) {
      clearSelection();
      return false;
    }
    paint();
    return true;
  }

  // La página ha sustituido la tabla entera: busca su reemplazo en la misma posición.
  // Si cambia el número de tablas, la posición ya no identifica a la misma tabla.
  function rebindTable() {
    const { root, tableIndex, tableCount, grid } = selection;
    if (!root.isConnected) return false;
    const tables = root.querySelectorAll('table');
    if (tables.length !== tableCount) return false;
    const candidate = tables[tableIndex];
    if (!candidate || buildGrid(candidate).colCount !== grid.colCount) return false;
    selection.table = candidate;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Localización de la celda bajo el puntero
  // ---------------------------------------------------------------------------

  function locateCell(event) {
    const path = event.composedPath();
    const elements = path.filter((node) => node.nodeType === 1);
    for (const el of elements) {
      if (el.localName === 'td' || el.localName === 'th') {
        const table = el.closest('table');
        return table ? { cell: el, table } : null;
      }
      if (el.localName === 'table' || el.localName === 'caption') break;
    }
    if (elements.some((el) => el.localName === 'caption')) return null;

    // Con pointer-events: none la celda no es el destino del evento, que recae
    // en la tabla o en un contenedor que la incluye.
    const scope = elements.find((el) => el.localName === 'table') || elements[0];
    if (!scope) return null;
    const candidates = scope.localName === 'table' ? [scope] : [];
    candidates.push(...scope.querySelectorAll('table'));
    for (let i = candidates.length - 1; i >= 0; i--) {
      const rect = candidates[i].getBoundingClientRect();
      if (
        event.clientX >= rect.left && event.clientX < rect.right &&
        event.clientY >= rect.top && event.clientY < rect.bottom
      ) {
        const grid = buildGrid(candidates[i]);
        if (grid.matrix.length === 0) return null;
        const cell = grid.matrix[rowAtY(grid, event.clientY)][colAtX(grid, event.clientX)];
        return cell ? { cell, table: candidates[i] } : null;
      }
    }
    return null;
  }

  function isModifierCombo(event) {
    return (IS_MAC ? event.metaKey : event.ctrlKey) && !event.altKey && !event.shiftKey;
  }

  function startsOnControl(event) {
    return event.composedPath().some((node) =>
      node.nodeType === 1 && (/^(input|textarea|select|button|video|audio)$/.test(node.localName) || isEditable(node))
    );
  }

  function isOnScrollbar(event) {
    const target = event.composedPath()[0];
    if (!target || target.nodeType !== 1) return false;
    const { clientX: x, clientY: y } = event;
    if (target === document.documentElement) return x >= target.clientWidth || y >= target.clientHeight;
    const rect = target.getBoundingClientRect();
    return (
      (target.clientWidth > 0 && x >= rect.left + target.clientLeft + target.clientWidth && x < rect.right) ||
      (target.clientHeight > 0 && y >= rect.top + target.clientTop + target.clientHeight && y < rect.bottom)
    );
  }

  // ---------------------------------------------------------------------------
  // Ciclo de arrastre
  // ---------------------------------------------------------------------------

  function beginPress(event) {
    if (press) endPress();
    if (!isModifierCombo(event) || startsOnControl(event)) return false;
    const hit = locateCell(event);
    if (!hit) return false;
    press = {
      cell: hit.cell,
      table: hit.table,
      onLink: event.composedPath().some((n) => n.nodeType === 1 && n.matches('a[href], area[href]')),
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      dragging: false,
      scroller: null,
      scrollPaused: false,
    };
    return true;
  }

  function stopEvent(event) {
    if (press) event.stopImmediatePropagation();
  }

  function blockEvent(event) {
    if (!press) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function startDrag() {
    const grid = buildGrid(press.table);
    const anchor = grid.info.get(press.cell);
    if (!anchor) return false;
    clearSelection();
    press.dragging = true;
    press.scroller = findScroller(press.table);
    createSelection(press.table, grid, { ...anchor }, { r: anchor.r0, c: anchor.c0 });
    document.documentElement.setAttribute(DRAG_ATTR, '');
    updateFocus();
    rafId = requestAnimationFrame(dragTick);
    return true;
  }

  function dragTick() {
    if (!press?.dragging || !selection) return;
    if (!press.scrollPaused) autoScroll();
    updateFocus();
    rafId = requestAnimationFrame(dragTick);
  }

  function updateFocus() {
    const { grid, focus } = selection;
    if (grid.matrix.length === 0) return;
    const r = rowAtY(grid, press.y);
    const c = colAtX(grid, press.x);
    if (r === focus.r && c === focus.c) return;
    selection.focus = { r, c };
    paint();
  }

  function findScroller(table) {
    let el = table.parentElement || table.getRootNode().host;
    while (el && el !== document.body && el !== document.documentElement) {
      const style = getComputedStyle(el);
      if (
        (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) ||
        (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth)
      ) {
        return el;
      }
      el = el.parentElement || el.getRootNode().host;
    }
    return null;
  }

  function scrollDelta(position, min, max) {
    let distance = 0;
    if (position < min + SCROLL_EDGE) distance = position - (min + SCROLL_EDGE);
    else if (position > max - SCROLL_EDGE) distance = position - (max - SCROLL_EDGE);
    if (distance === 0) return 0;
    return Math.sign(distance) * Math.min(SCROLL_MAX_SPEED, Math.ceil(Math.abs(distance) / 3) + 1);
  }

  function autoScroll() {
    const { x, y, scroller } = press;
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      const dx = scrollDelta(x, rect.left, rect.right);
      const dy = scrollDelta(y, rect.top, rect.bottom);
      if (dx || dy) scroller.scrollBy(dx, dy);
    }
    const dx = scrollDelta(x, 0, window.innerWidth);
    const dy = scrollDelta(y, 0, window.innerHeight);
    if (dx || dy) window.scrollBy(dx, dy);
  }

  function onMouseMove(event) {
    if (!press) return;
    event.stopImmediatePropagation();
    if (!(event.buttons & 1)) {
      // El botón se soltó sin que llegara el mouseup.
      endPress();
      return;
    }
    press.x = event.clientX;
    press.y = event.clientY;
    press.scrollPaused = false;
    if (
      !press.dragging &&
      Math.hypot(press.x - press.startX, press.y - press.startY) >= DRAG_THRESHOLD
    ) {
      startDrag();
    }
  }

  function onMouseUp(event) {
    if (!press || event.button !== 0) return;
    event.stopImmediatePropagation();
    press.x = event.clientX;
    press.y = event.clientY;
    endPress();
  }

  // Perder el foco no termina el arrastre: una notificación o la activación tardía de
  // la ventana lo cortarían. Si el botón se suelta fuera, lo detecta el siguiente
  // mousemove; mientras tanto no se desplaza la página sin que nadie la controle.
  function onWindowBlur(event) {
    if (press && event.target === window) press.scrollPaused = true;
  }

  function endPress() {
    if (!press) return;
    const finished = press;
    cancelAnimationFrame(rafId);
    document.documentElement.removeAttribute(DRAG_ATTR);
    if (finished.dragging) {
      if (selection) updateFocus();
      armClickSuppression();
    } else if (!finished.onLink) {
      selectSingleCell(finished);
    }
    press = null;
  }

  // Tras un arrastre, el clic resultante no debe abrir enlaces ni activar la fila.
  function armClickSuppression() {
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 50);
  }

  // Ctrl + clic selecciona una celda; repetirlo sobre ella la deselecciona.
  function selectSingleCell({ cell, table }) {
    const grid = buildGrid(table);
    const anchor = grid.info.get(cell);
    if (!anchor) return;
    const wasSame = selection && selection.table === table && selection.marks.size === 1 && selection.marks.has(cell);
    clearSelection();
    if (!wasSame) createSelection(table, grid, { ...anchor }, { r: anchor.r0, c: anchor.c0 });
  }

  function cancelAll() {
    if (press) {
      const wasDragging = press.dragging;
      cancelAnimationFrame(rafId);
      document.documentElement.removeAttribute(DRAG_ATTR);
      press = null;
      if (wasDragging) armClickSuppression();
    }
    clearSelection();
  }

  // ---------------------------------------------------------------------------
  // Copiado
  // ---------------------------------------------------------------------------

  function cellText(cell) {
    return (cell.innerText || '')
      .replace(/ /g, ' ')
      .split(/[\r\n\t]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ');
  }

  function escapeHtml(text) {
    return text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  }

  // Las celdas combinadas se recortan al rectángulo: seleccionar una columna
  // nunca añade columnas aunque una fila contenga un colspan.
  function serializeSelection() {
    const { grid } = selection;
    const { r0, r1, c0, c1 } = selectionRect();
    const seen = new Set();
    const textRows = [];
    const htmlRows = [];
    for (let r = r0; r <= r1; r++) {
      const texts = [];
      let html = '';
      for (let c = c0; c <= c1; c++) {
        const cell = grid.matrix[r][c];
        if (!cell) {
          texts.push('');
          html += '<td></td>';
          continue;
        }
        if (seen.has(cell)) {
          texts.push('');
          continue;
        }
        seen.add(cell);
        const text = cellText(cell);
        const extent = grid.info.get(cell);
        const rowSpan = Math.min(extent.r1, r1) - r + 1;
        const colSpan = Math.min(extent.c1, c1) - c + 1;
        const tag = cell.localName;
        const spans = (rowSpan > 1 ? ` rowspan="${rowSpan}"` : '') + (colSpan > 1 ? ` colspan="${colSpan}"` : '');
        const style = FORMULA_LIKE.test(text) ? ` style="mso-number-format:'\\@'"` : '';
        texts.push(text);
        html += `<${tag}${spans}${style}>${escapeHtml(text)}</${tag}>`;
      }
      textRows.push(texts.join('\t'));
      htmlRows.push(`<tr>${html}</tr>`);
    }
    return {
      text: textRows.join('\n'),
      html: `<table><tbody>${htmlRows.join('')}</tbody></table>`,
    };
  }

  function copySelection() {
    if (!refreshSelection()) return;
    copyPayload = serializeSelection();
    copyHandled = false;
    const payload = copyPayload;
    let succeeded = false;
    try {
      succeeded = document.execCommand('copy');
    } catch {
      succeeded = false;
    }
    copyPayload = null;
    if (succeeded && copyHandled) return;

    navigator.clipboard?.write([
      new ClipboardItem({
        'text/plain': new Blob([payload.text], { type: 'text/plain' }),
        'text/html': new Blob([payload.html], { type: 'text/html' }),
      }),
    ]).catch((error) => console.warn('Selector de celdas: no se pudo copiar', error));
  }

  // ---------------------------------------------------------------------------
  // Manejadores permanentes
  // ---------------------------------------------------------------------------

  function onPointerDown(event) {
    if (!event.isTrusted || event.pointerType !== 'mouse' || event.button !== 0) return;
    // Sin preventDefault: anularía los mousedown/mouseup de compatibilidad.
    if (beginPress(event)) event.stopImmediatePropagation();
  }

  function onMouseDown(event) {
    if (!event.isTrusted || event.button !== 0) return;
    suppressClick = false;
    // buttons === 1: con el botón derecho ya pulsado está en curso una caja de checkboxes.
    if (!press && isModifierCombo(event) && event.buttons === 1) beginPress(event);
    if (press) {
      // Evita la selección de texto nativa y el arrastre de enlaces e imágenes.
      event.preventDefault();
      event.stopImmediatePropagation();
      window.focus();
      return;
    }
    if (selection && !isModifierCombo(event) && !isOnScrollbar(event)) clearSelection();
  }

  function onClick(event) {
    // Los click() de checkboxes.js no son consecuencia de un arrastre de celdas.
    if (!suppressClick || !event.isTrusted) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function isCopyKey(event) {
    if (!isModifierCombo(event)) return false;
    const key = event.key.toLowerCase();
    return key === 'c' || (event.code === 'KeyC' && !/^[a-z]$/.test(key));
  }

  function onKeyDown(event) {
    if (!event.isTrusted || !(selection || press)) return;
    if (event.key === 'Escape') {
      cancelAll();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!press && isCopyKey(event) && !isEditable(event.composedPath()[0])) {
      event.preventDefault();
      event.stopImmediatePropagation();
      copySelection();
    }
  }

  // Sin selección de texto, execCommand('copy') solo se habilita si se cancela beforecopy.
  function onBeforeCopy(event) {
    if (!copyPayload) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onCopy(event) {
    if (!copyPayload || !event.clipboardData) return;
    event.clipboardData.setData('text/plain', copyPayload.text);
    event.clipboardData.setData('text/html', copyPayload.html);
    event.preventDefault();
    event.stopImmediatePropagation();
    copyHandled = true;
  }

  function onSelectionChange() {
    if (selection && !press && window.getSelection()?.isCollapsed === false) clearSelection();
  }

  function onFocusIn(event) {
    if (selection && !press && isEditable(event.composedPath()[0])) clearSelection();
  }

  // Todos se registran ahora, también los del arrastre: uno añadido al pulsar el
  // ratón quedaría detrás de los de la página y esta podría detenerlo.
  const LISTENERS = {
    pointerdown: onPointerDown,
    mousedown: onMouseDown,
    pointermove: stopEvent,
    mousemove: onMouseMove,
    pointerup: stopEvent,
    mouseup: onMouseUp,
    pointercancel: endPress,
    blur: onWindowBlur,
    dragstart: blockEvent,
    selectstart: blockEvent,
    click: onClick,
    keydown: onKeyDown,
    beforecopy: onBeforeCopy,
    copy: onCopy,
    focusin: onFocusIn,
  };
  for (const [type, handler] of Object.entries(LISTENERS)) window.addEventListener(type, handler, true);
  document.addEventListener('selectionchange', onSelectionChange);
})();
