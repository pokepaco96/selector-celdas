const fs = require('fs');
const path = require('path');
const {
  test, expect, launch, startServer, writeSentinel, readClipboard, parseClipboardTable, htmlTexts,
  drag, ctrlClick, selectedCells, countSelected, pressCopy, cellCenter, SENTINEL,
} = require('../helpers');

test.describe('Eventos e interferencias de la página', () => {
  test('tabla 8: manejadores hostiles no impiden la selección ni los ven', async ({ page }) => {
    await drag(page, '#t8', [0, 0], [2, 1]);
    expect(await selectedCells(page, '#t8')).toEqual([['H-1', 'H-2'], ['H-3', 'H-4'], ['H-5', 'H-6']]);
    const hostile = await page.evaluate(() => window.hostile);
    // El único mousemove visible es el previo a pulsar el botón, cuando no hay arrastre.
    expect(hostile).toMatchObject({ mousedown: 0, pointerdown: 0, mousemove: 1, mouseup: 0, selectstart: 0, dragstart: 0, click: 0 });
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe('H-1\tH-2\nH-3\tH-4\nH-5\tH-6');
  });

  test('tabla 8: copia aunque la página bloquee copy y Ctrl+C', async ({ page }) => {
    await page.evaluate(() => { window.hostileCopy = true; });
    await drag(page, '#t8', [0, 1], [2, 1]);
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe('H-2\nH-4\nH-6');
    expect(await page.evaluate(() => window.hostile)).toMatchObject({ copyBlocked: 0, keyBlocked: 0 });
  });

  test('tabla 8: sin selección activa la extensión no intercepta Ctrl+C', async ({ page }) => {
    await page.evaluate(() => { window.hostileCopy = true; });
    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('parrafo'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await pressCopy(page);
    const hostile = await page.evaluate(() => window.hostile);
    expect(hostile.keyBlocked).toBe(1);
  });

  test('pointer-events none en las celdas', async ({ page }) => {
    await drag(page, '#t8b', [0, 1], [2, 1]);
    expect(await selectedCells(page, '#t8b')).toEqual([['PE-2'], ['PE-4'], ['PE-6']]);
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe('PE-2\nPE-4\nPE-6');
  });

  test('pointer-events none en toda la tabla', async ({ page }) => {
    await drag(page, '#t8c', [0, 0], [1, 1]);
    expect(await selectedCells(page, '#t8c')).toEqual([['TP-1', 'TP-2'], ['TP-3', 'TP-4']]);
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe('TP-1\tTP-2\nTP-3\tTP-4');
  });

  test('arrastrar desde un enlace no lo abre ni lo arrastra', async ({ page, browserContext }) => {
    const pagesBefore = browserContext.pages().length;
    const urlBefore = page.url();
    await page.evaluate(() => {
      window.dragStarts = 0;
      window.addEventListener('dragstart', () => { window.dragStarts++; });
    });
    await drag(page, '#t3', [0, 1], [3, 1]);
    await page.waitForTimeout(200);
    expect(page.url()).toBe(urlBefore);
    expect(browserContext.pages().length).toBe(pagesBefore);
    expect(await page.evaluate(() => window.dragStarts)).toBe(0);
    expect(await page.evaluate(() => window.pageLog.linkClicks)).toBe(0);
    expect(await selectedCells(page, '#t3')).toEqual([['Enlace 1'], ['Enlace 2'], ['Enlace 3'], ['Enlace 4']]);
  });

  test('arrastre corto dentro del mismo enlace no lo abre', async ({ page, browserContext }) => {
    const pagesBefore = browserContext.pages().length;
    const c = await cellCenter(page, '#t3', 0, 1);
    await page.keyboard.down('Control');
    await page.mouse.move(c.x - 10, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 10, c.y, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    expect(browserContext.pages().length).toBe(pagesBefore);
    expect(await page.evaluate(() => window.pageLog.linkClicks)).toBe(0);
    expect(await selectedCells(page, '#t3')).toEqual([['Enlace 1']]);
  });

  test('el clic tras el arrastre no llega a la página', async ({ page }) => {
    const before = await page.evaluate(() => window.pageLog.clicks);
    await drag(page, '#t1', [0, 0], [2, 0]);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.pageLog.clicks)).toBe(before);
  });

  test('no queda texto nativo seleccionado fuera de la tabla', async ({ page }) => {
    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('parrafo'));
      getSelection().addRange(range);
    });
    await drag(page, '#t1', [0, 0], [2, 0]);
    expect(await page.evaluate(() => getSelection().toString())).toBe('');
    expect(await countSelected(page)).toBe(3);
  });

  test('una selección nativa posterior anula la de celdas', async ({ page }) => {
    await drag(page, '#t1', [0, 0], [2, 0]);
    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('parrafo'));
      getSelection().addRange(range);
    });
    await page.waitForTimeout(50);
    expect(await countSelected(page)).toBe(0);
  });
});

test.describe('Cursor, teclas y foco', () => {
  test('el cursor abandona la tabla: la selección se ajusta al borde', async ({ page }) => {
    const start = await cellCenter(page, '#t2', 1, 0);
    const box = await page.$eval('#t2', (t) => {
      const r = t.getBoundingClientRect();
      return { right: r.right, bottom: r.bottom };
    });
    await page.keyboard.down('Control');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(box.right + 200, box.bottom + 60, { steps: 6 });
    await page.waitForTimeout(40);
    await page.mouse.up();
    await page.keyboard.up('Control');
    expect(await selectedCells(page, '#t2')).toEqual([['Ana', 'Madrid'], ['Luis', 'Sevilla'], ['Marta', 'Bilbao'], ['Pablo', 'Cádiz']]);
    await page.mouse.move(box.right + 200, box.bottom + 60);
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe('Ana\tMadrid\nLuis\tSevilla\nMarta\tBilbao\nPablo\tCádiz');
  });

  test('el cursor sale por arriba: conserva la columna', async ({ page }) => {
    const start = await cellCenter(page, '#t2', 3, 1);
    const top = await page.$eval('#t2', (t) => t.getBoundingClientRect().top);
    await page.keyboard.down('Control');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, top - 30, { steps: 5 });
    await page.waitForTimeout(40);
    await page.mouse.up();
    await page.keyboard.up('Control');
    expect(await selectedCells(page, '#t2')).toEqual([['Ciudad'], ['Madrid'], ['Sevilla'], ['Bilbao']]);
  });

  test('soltar Ctrl durante el arrastre no interrumpe la selección', async ({ page }) => {
    const a = await cellCenter(page, '#t1', 0, 0);
    const b = await cellCenter(page, '#t1', 2, 0, { scroll: false });
    await page.keyboard.down('Control');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x, a.y + 8, { steps: 2 });
    await page.keyboard.up('Control');
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.waitForTimeout(40);
    await page.mouse.up();
    expect(await countSelected(page)).toBe(3);
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe('Manzana\nPera\nUva');
  });

  test('mouseup perdido: el siguiente movimiento sin botón termina el arrastre', async ({ page, browserContext }) => {
    const a = await cellCenter(page, '#t1', 0, 0);
    const b = await cellCenter(page, '#t1', 1, 0, { scroll: false });
    const c = await cellCenter(page, '#t1', 4, 0, { scroll: false });
    await page.keyboard.down('Control');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.waitForTimeout(40);
    await page.keyboard.up('Control');
    const cdp = await browserContext.newCDPSession(page);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', buttons: 0 });
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.mouse.move(c.x, c.y + 3);
    await page.waitForTimeout(60);
    expect(await selectedCells(page, '#t1')).toEqual([['Manzana'], ['Pera']]);
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-cellsel-drag'))).toBe(false);
  });

  test('perder el foco no corta el arrastre, que sigue hasta soltar', async ({ page }) => {
    const a = await cellCenter(page, '#t1', 0, 0);
    const b = await cellCenter(page, '#t1', 2, 0, { scroll: false });
    const c = await cellCenter(page, '#t1', 3, 0, { scroll: false });
    await page.keyboard.down('Control');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.waitForTimeout(40);
    // El isolated world recibe el mismo evento blur de window; el manejador solo
    // comprueba su destino, igual que al cambiar de ventana.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.move(c.x, c.y, { steps: 2 });
    await page.waitForTimeout(40);
    await page.mouse.up();
    await page.keyboard.up('Control');
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-cellsel-drag'))).toBe(false);
    expect(await countSelected(page)).toBe(4);
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe('Manzana\nPera\nUva\nKiwi');
  });

  test('perder el foco pausa el autodesplazamiento hasta que vuelve el ratón', async ({ page }) => {
    const start = await cellCenter(page, '#t14', 1, 0);
    const box = await page.$eval('#scroller', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + 40, bottom: r.bottom };
    });
    await page.keyboard.down('Control');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(box.x, box.bottom - 4, { steps: 5 });
    await page.waitForTimeout(100);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(50);
    const paused = await page.$eval('#scroller', (el) => el.scrollTop);
    await page.waitForTimeout(200);
    expect(await page.$eval('#scroller', (el) => el.scrollTop)).toBe(paused);
    await page.mouse.move(box.x, box.bottom - 3);
    await page.waitForTimeout(200);
    expect(await page.$eval('#scroller', (el) => el.scrollTop)).toBeGreaterThan(paused);
    await page.mouse.up();
    await page.keyboard.up('Control');
  });

  test('con el foco en un campo, Ctrl+arrastrar y Ctrl+C copian las celdas', async ({ page }) => {
    await page.focus('#campo');
    await page.evaluate(() => document.getElementById('campo').select());
    await drag(page, '#t1', [0, 0], [1, 0]);
    expect(await page.evaluate(() => document.activeElement.id)).not.toBe('campo');
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe('Manzana\nPera');
  });

  test('un clic normal fuera cancela la selección', async ({ page }) => {
    await drag(page, '#t1', [0, 0], [1, 0]);
    await page.click('#parrafo');
    expect(await countSelected(page)).toBe(0);
  });

  test('un clic normal dentro de la tabla también cancela', async ({ page }) => {
    await drag(page, '#t1', [0, 0], [1, 0]);
    const c = await cellCenter(page, '#t1', 0, 0);
    await page.mouse.click(c.x, c.y);
    expect(await countSelected(page)).toBe(0);
  });

  test('un clic en la barra de desplazamiento no cancela', async ({ page }) => {
    await drag(page, '#t14', [1, 0], [2, 0]);
    expect(await countSelected(page)).toBe(2);
    const box = await page.$eval('#scroller', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.right - 4, y: r.top + 60 };
    });
    await page.mouse.click(box.x, box.y);
    expect(await countSelected(page)).toBe(2);
  });

  test('el clic derecho no cancela', async ({ page }) => {
    await drag(page, '#t1', [0, 0], [1, 0]);
    const c = await cellCenter(page, '#t1', 0, 0);
    await page.mouse.click(c.x, c.y, { button: 'right' });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    expect(await countSelected(page)).toBe(0);
  });

  test('autodesplazamiento al llevar el cursor al borde del contenedor', async ({ page }) => {
    const start = await cellCenter(page, '#t14', 1, 0);
    const box = await page.$eval('#scroller', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + 40, bottom: r.bottom };
    });
    await page.keyboard.down('Control');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(box.x, box.bottom - 4, { steps: 5 });
    await page.waitForTimeout(500);
    await page.mouse.up();
    await page.keyboard.up('Control');
    const scrollTop = await page.$eval('#scroller', (el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
    const count = await countSelected(page);
    expect(count).toBeGreaterThan(5);
    await pressCopy(page);
    const { text } = await readClipboard(page);
    const lines = text.split('\n');
    expect(lines.length).toBe(count);
    expect(lines[0]).toBe('Fila 2');
    expect(lines.every((line, i) => line === `Fila ${i + 2}`)).toBe(true);
  });
});

test.describe('Tablas dinámicas', () => {
  test('tabla 7: texto actualizado se copia con su valor actual', async ({ page }) => {
    await drag(page, '#t7', [0, 0], [1, 0]);
    await page.evaluate(() => window.dyn.setValue(1, 'Actualizado'));
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe('Uno\nActualizado');
  });

  test('tabla 7: actualización periódica mientras se selecciona', async ({ page }) => {
    await page.evaluate(() => window.dyn.start());
    await drag(page, '#t7', [0, 1], [3, 1]);
    await page.waitForTimeout(250);
    expect(await countSelected(page)).toBe(4);
    await pressCopy(page);
    const { text } = await readClipboard(page);
    await page.evaluate(() => window.dyn.stop());
    const lines = text.split('\n');
    expect(lines.length).toBe(4);
    expect(new Set(lines).size).toBe(1);
    expect(Number(lines[0])).toBeGreaterThan(0);
  });

  test('tabla 7: cuerpo re-renderizado conserva selección y resaltado', async ({ page }) => {
    await drag(page, '#t7', [1, 0], [2, 0]);
    await page.evaluate(() => {
      window.dyn.values = ['A', 'B', 'C', 'D'];
      window.dyn.rerenderBody();
    });
    await page.waitForTimeout(100);
    expect(await selectedCells(page, '#t7')).toEqual([['B'], ['C']]);
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe('B\nC');
  });

  test('tabla 7: tabla sustituida por completo se reasocia', async ({ page }) => {
    await drag(page, '#t7', [0, 0], [1, 0]);
    await page.evaluate(() => {
      window.dyn.values = ['X', 'Y', 'Z', 'W'];
      window.dyn.replaceTable();
    });
    await page.waitForTimeout(100);
    expect(await selectedCells(page, '#t7')).toEqual([['X'], ['Y']]);
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe('X\nY');
  });

  test('tabla 7: filas eliminadas recortan la selección sin errores', async ({ page }) => {
    await drag(page, '#t7', [0, 0], [3, 0]);
    await page.evaluate(() => {
      window.dyn.values = ['Solo', 'Dos'];
      window.dyn.rerenderBody();
    });
    await page.waitForTimeout(100);
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe('Solo\nDos');
  });

  test('tabla 7: tabla eliminada cancela la selección y Ctrl+C no copia', async ({ page }) => {
    await drag(page, '#t7', [0, 0], [1, 0]);
    await page.evaluate(() => { document.getElementById('t7-wrap').innerHTML = '<p>sin tabla</p>'; });
    await page.waitForTimeout(100);
    await pressCopy(page);
    expect(await countSelected(page)).toBe(0);
  });
});

test.describe('Funcionamiento normal de la página', () => {
  test('sin Ctrl, arrastrar selecciona texto nativo y no marca celdas', async ({ page }) => {
    await drag(page, '#t2', [1, 0], [2, 0], { modifier: null });
    expect(await countSelected(page)).toBe(0);
    expect(await page.evaluate(() => getSelection().toString())).toContain('Madrid');
    await pressCopy(page);
    expect((await readClipboard(page)).text).toContain('Madrid');
  });

  test('clic normal en un enlace navega', async ({ page }) => {
    await page.click('#enlace-normal');
    await page.waitForURL('**/otra.html?normal=1');
  });

  test('clic normal en enlace de tabla navega', async ({ page }) => {
    await page.click('#link-1');
    await page.waitForURL('**/otra.html?n=1');
  });

  test('Ctrl + clic en un enlace fuera de tabla abre pestaña', async ({ page, browserContext }) => {
    await page.$eval('#enlace-normal', (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const box = await (await page.$('#enlace-normal')).boundingBox();
    const opened = browserContext.waitForEvent('page');
    await page.keyboard.down('Control');
    await page.mouse.click(box.x + 5, box.y + 5);
    await page.keyboard.up('Control');
    await (await opened).close();
  });

  test('Ctrl + clic en un enlace de tabla abre pestaña y no selecciona', async ({ page, browserContext }) => {
    const opened = browserContext.waitForEvent('page');
    await ctrlClick(page, '#t3', 2, 1);
    await (await opened).close();
    expect(await countSelected(page)).toBe(0);
  });

  test('los eventos de ratón llegan a la página cuando no hay Ctrl', async ({ page }) => {
    await page.click('#parrafo');
    expect(await page.evaluate(() => window.pageLog)).toMatchObject({ clicks: 1, mousedowns: 1 });
  });

  test('Escape llega a la página si no hay selección activa', async ({ page }) => {
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.pageLog.escapes)).toBe(1);
  });

  test('Escape con selección activa no llega a la página', async ({ page }) => {
    await drag(page, '#t1', [0, 0], [1, 0]);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.pageLog.escapes)).toBe(0);
  });

  test('Ctrl+C nativo en un campo de texto', async ({ page }) => {
    await page.focus('#campo');
    await page.evaluate(() => document.getElementById('campo').select());
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe('contenido del campo');
  });

  test('con selección activa, entrar en un campo la cancela y Ctrl+C es nativo', async ({ page }) => {
    await drag(page, '#t1', [0, 0], [1, 0]);
    await page.click('#area');
    expect(await countSelected(page)).toBe(0);
    await page.evaluate(() => document.getElementById('area').select());
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe('texto del área');
  });

  test('llegar a un campo con Tab cancela la selección', async ({ page }) => {
    await drag(page, '#t9', [0, 1], [1, 1]);
    expect(await countSelected(page)).toBe(2);
    await page.evaluate(() => document.getElementById('campo').focus());
    await page.waitForTimeout(30);
    expect(await countSelected(page)).toBe(0);
  });

  test('Ctrl+C sin selección y sin texto no altera el portapapeles', async ({ page }) => {
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe(SENTINEL);
  });

  test('Ctrl + arrastrar en campo y controles de celda no inicia selección', async ({ page }) => {
    await page.$eval('#t9', (t) => t.scrollIntoView({ block: 'center', behavior: 'instant' }));
    for (const id of ['cell-input', 'cell-button', 'cell-editable']) {
      const box = await (await page.$(`#${id}`)).boundingBox();
      await page.keyboard.down('Control');
      await page.mouse.move(box.x + 5, box.y + 5);
      await page.mouse.down();
      await page.mouse.move(box.x + 30, box.y + 40, { steps: 3 });
      await page.mouse.up();
      await page.keyboard.up('Control');
      expect(await countSelected(page), id).toBe(0);
    }
  });

  test('Ctrl + clic fuera de tablas no crea selección', async ({ page }) => {
    await page.$eval('#parrafo', (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const box = await (await page.$('#parrafo')).boundingBox();
    await page.keyboard.down('Control');
    await page.mouse.click(box.x + 5, box.y + 5);
    await page.keyboard.up('Control');
    expect(await countSelected(page)).toBe(0);
  });

  test('otras combinaciones (Ctrl+Mayús, Ctrl+Alt) no seleccionan', async ({ page }) => {
    const a = await cellCenter(page, '#t1', 0, 0);
    const b = await cellCenter(page, '#t1', 2, 0, { scroll: false });
    for (const extra of ['Shift', 'Alt']) {
      await page.keyboard.down('Control');
      await page.keyboard.down(extra);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 3 });
      await page.mouse.up();
      await page.keyboard.up(extra);
      await page.keyboard.up('Control');
      expect(await countSelected(page), extra).toBe(0);
      await page.evaluate(() => getSelection().removeAllRanges());
    }
  });
});

test.describe('Instalación e integración', () => {
  test('cada icono del manifiesto existe y mide lo que declara', async () => {
    const dir = process.env.EXTENSION_PATH || path.join(__dirname, '..', '..', 'extension');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    for (const [size, file] of Object.entries(manifest.icons)) {
      const png = fs.readFileSync(path.join(dir, file));
      // Cabecera PNG: anchura y altura en los bytes 16 y 20.
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], file).toEqual([Number(size), Number(size)]);
    }
  });

  test('control: sin la extensión, Ctrl+arrastrar no selecciona celdas', async ({ baseUrl }) => {
    const { context, close } = await launch({ withExtension: false });
    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/pruebas.html`);
      await drag(page, '#t1', [0, 0], [2, 0]);
      expect(await countSelected(page)).toBe(0);
    } finally {
      await close();
    }
  });

  test('página http no segura: copia sin navigator.clipboard', async ({ browserContext, baseUrl, server }) => {
    const insecure = await browserContext.newPage();
    const errors = [];
    insecure.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    insecure.on('pageerror', (err) => errors.push(err.message));
    await insecure.goto(`http://celdas.test:${server.address().port}/pruebas.html`);
    expect(await insecure.evaluate(() => [window.isSecureContext, typeof navigator.clipboard])).toEqual([false, 'undefined']);
    const reader = await browserContext.newPage();
    await reader.goto(`${baseUrl}/otra.html`);
    await reader.bringToFront();
    await writeSentinel(reader);
    await insecure.bringToFront();
    await drag(insecure, '#t2', [1, 1], [2, 1]);
    await pressCopy(insecure);
    const clip = await readClipboard(reader);
    expect(clip.text).toBe('Madrid\nSevilla');
    const parsed = await parseClipboardTable(reader, clip.html);
    expect(htmlTexts(parsed)).toEqual([['Madrid'], ['Sevilla']]);
    expect(errors).toEqual([]);
    await insecure.close();
    await reader.close();
  });

  test('pegado real: un editor de la propia página recibe ambos formatos', async ({ page }) => {
    await drag(page, '#t2', [1, 0], [2, 1]);
    await pressCopy(page);
    await page.evaluate(() => {
      window.pasted = null;
      document.getElementById('area').addEventListener('paste', (e) => {
        window.pasted = {
          types: [...e.clipboardData.types],
          text: e.clipboardData.getData('text/plain'),
          html: e.clipboardData.getData('text/html'),
        };
      });
    });
    await page.click('#area');
    await page.evaluate(() => document.getElementById('area').select());
    await page.keyboard.press('Control+v');
    const pasted = await page.evaluate(() => window.pasted);
    expect(pasted.types).toEqual(expect.arrayContaining(['text/plain', 'text/html']));
    expect(pasted.text).toBe('Ana\tMadrid\nLuis\tSevilla');
    expect(htmlTexts(await parseClipboardTable(page, pasted.html))).toEqual([['Ana', 'Madrid'], ['Luis', 'Sevilla']]);
    expect(await page.$eval('#area', (el) => el.value)).toBe('Ana\tMadrid\nLuis\tSevilla');
  });
});

test.describe('Rendimiento', () => {
  test('5000 × 10: seleccionar y copiar una columna completa', async ({ browserContext, baseUrl }) => {
    const page = await browserContext.newPage();
    await page.goto(`${baseUrl}/rendimiento.html`);
    await page.bringToFront();

    // Arrastre corto con pasos reales.
    const started = Date.now();
    const a = await cellCenter(page, '#grande', 0, 3);
    await page.keyboard.down('Control');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 15; i++) {
      await page.mouse.move(a.x, Math.min(a.y + i * 40, 820));
    }
    const dragMs = Date.now() - started;
    await page.mouse.up();
    await page.keyboard.up('Control');
    expect(await countSelected(page)).toBeGreaterThan(10);
    await page.keyboard.press('Escape');

    // Columna completa: con el arrastre activo se salta al final de la página y el
    // cursor se sitúa sobre la última fila.
    const top = await cellCenter(page, '#grande', 0, 3);
    await page.keyboard.down('Control');
    await page.mouse.move(top.x, top.y);
    await page.mouse.down();
    await page.mouse.move(top.x, top.y + 10);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const bottom = await cellCenter(page, '#grande', 4999, 3, { scroll: false });
    const fullStart = Date.now();
    await page.mouse.move(bottom.x, bottom.y);
    await page.waitForFunction(() => document.querySelectorAll('[data-cellsel]').length === 5000);
    const fullPaintMs = Date.now() - fullStart;
    await page.mouse.up();
    await page.keyboard.up('Control');

    const fullCopyStart = Date.now();
    await page.keyboard.press('Control+c');
    const fullCopyMs = Date.now() - fullCopyStart;
    await page.waitForTimeout(100);

    const longTasks = await page.evaluate(() => window.longTasks);
    console.log(JSON.stringify({ dragMs, fullPaintMs, fullCopyMs, longTasksMs: longTasks.slice(-8) }));

    expect(fullPaintMs).toBeLessThan(2000);
    expect(fullCopyMs).toBeLessThan(3000);

    const clip = await readClipboard(page);
    const lines = clip.text.split('\n');
    expect(lines.length).toBe(5000);
    expect(lines[0]).toBe('F0C3');
    expect(lines[4999]).toBe('F4999C3');
    await page.close();
  });
});
