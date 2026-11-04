// Selector de checkboxes: Shift + clic derecho + arrastrar dibuja una caja y alterna,
// una sola vez por arrastre, las casillas cuyo centro queda dentro de ella.
//
// Sigue el mismo patrón que content.js: captura sobre window desde document_start, y
// sin un arrastre en curso no se cancela ni se detiene ningún evento.
(() => {
  'use strict';

  const BOX_ID = 'cellsel-checkbox-box';
  const MENU_GRACE_MS = 200; // en Windows, contextmenu llega justo después del mouseup

  let drag = null; // { startX, startY, x, y, lastKey, toggled }
  let box = null;
  let rafId = 0;
  let suppressMenu = false;
  let menuTimer = 0;

  // Se crea al usarla: en document_start todavía no existe el body.
  function getBox() {
    if (!box) {
      box = document.createElement('div');
      box.id = BOX_ID;
    }
    if (!box.isConnected) document.documentElement.appendChild(box);
    return box;
  }

  function isStart(event) {
    return event.isTrusted && event.button === 2 && event.shiftKey && event.buttons === 2;
  }

  function begin(event) {
    clearTimeout(menuTimer);
    suppressMenu = true;
    drag = {
      // Coordenadas de página: la caja sigue anclada aunque se desplace durante el arrastre.
      startX: event.pageX,
      startY: event.pageY,
      x: event.clientX,
      y: event.clientY,
      lastKey: '',
      toggled: new Set(),
    };
    const el = getBox();
    el.style.width = '0px';
    el.style.height = '0px';
    el.style.left = `${event.clientX}px`;
    el.style.top = `${event.clientY}px`;
    el.style.display = 'block';
    rafId = requestAnimationFrame(tick);
  }

  function tick() {
    if (!drag) return;
    update();
    rafId = requestAnimationFrame(tick);
  }

  function update() {
    const key = `${drag.x},${drag.y},${window.scrollX},${window.scrollY}`;
    if (key === drag.lastKey) return;
    drag.lastKey = key;

    const currentX = drag.x + window.scrollX;
    const currentY = drag.y + window.scrollY;
    const left = Math.min(drag.startX, currentX);
    const top = Math.min(drag.startY, currentY);
    const width = Math.abs(currentX - drag.startX);
    const height = Math.abs(currentY - drag.startY);

    toggleInside(left - window.scrollX, top - window.scrollY, width, height);

    box.style.left = `${left - window.scrollX}px`;
    box.style.top = `${top - window.scrollY}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
  }

  function toggleInside(left, top, width, height) {
    const pending = [];
    for (const checkbox of document.querySelectorAll('input[type="checkbox"]')) {
      if (drag.toggled.has(checkbox)) continue;
      const rect = checkbox.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      if (centerX >= left && centerX <= left + width && centerY >= top && centerY <= top + height) {
        pending.push(checkbox);
      }
    }
    // En dos pasos: click() puede ejecutar código de la página que altere el DOM.
    for (const checkbox of pending) {
      if (!isToggleable(checkbox)) continue;
      drag.toggled.add(checkbox);
      // click() lanza click, input y change: sin ellos, una web con JavaScript no ve el cambio.
      checkbox.click();
    }
  }

  function isToggleable(checkbox) {
    return (
      !checkbox.matches(':disabled') &&
      checkbox.getClientRects().length > 0 &&
      getComputedStyle(checkbox).visibility === 'visible'
    );
  }

  function end() {
    if (!drag) return;
    cancelAnimationFrame(rafId);
    drag = null;
    if (box) box.style.display = 'none';
    clearTimeout(menuTimer);
    menuTimer = setTimeout(() => {
      suppressMenu = false;
    }, MENU_GRACE_MS);
  }

  function stopEvent(event) {
    if (drag) event.stopImmediatePropagation();
  }

  function onPointerDown(event) {
    if (event.pointerType !== 'mouse' || !isStart(event)) return;
    if (drag) end();
    begin(event);
    event.stopImmediatePropagation();
  }

  function onMouseDown(event) {
    if (!drag && isStart(event)) begin(event);
    if (!drag) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onMouseMove(event) {
    if (!drag) return;
    event.stopImmediatePropagation();
    if (!(event.buttons & 2)) {
      // El botón se soltó sin que llegara el mouseup.
      end();
      return;
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
  }

  function onMouseUp(event) {
    if (!drag || event.button !== 2) return;
    event.stopImmediatePropagation();
    drag.x = event.clientX;
    drag.y = event.clientY;
    update();
    end();
  }

  function onContextMenu(event) {
    if (!suppressMenu) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  const LISTENERS = {
    pointerdown: onPointerDown,
    mousedown: onMouseDown,
    pointermove: stopEvent,
    mousemove: onMouseMove,
    pointerup: stopEvent,
    mouseup: onMouseUp,
    pointercancel: end,
    contextmenu: onContextMenu,
  };
  for (const [type, handler] of Object.entries(LISTENERS)) window.addEventListener(type, handler, true);
})();
