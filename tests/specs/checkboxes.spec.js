const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  test, expect, launch, readClipboard, drag, selectedCells, countSelected, pressCopy,
} = require('../helpers');

const ORIGINAL_ZIP = path.join(__dirname, '..', '..', 'checkbox-ruanox_firefox.zip');

async function center(scope, selector) {
  return scope.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

// Lleva a la vista el primer elemento sin dejarlo cerca de los bordes.
async function centerView(page, selector) {
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
}

// Shift + clic derecho + arrastrar entre dos checkboxes, con holgura para cubrir sus centros.
async function boxDrag(page, from, to, { pad = 6, scope = page, origin = { x: 0, y: 0 } } = {}) {
  await centerView(scope, from);
  const a = await center(scope, from);
  const b = await center(scope, to);
  const signX = b.x >= a.x ? 1 : -1;
  const signY = b.y >= a.y ? 1 : -1;
  await page.keyboard.down('Shift');
  await page.mouse.move(origin.x + a.x - pad * signX, origin.y + a.y - pad * signY);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(origin.x + b.x + pad * signX, origin.y + b.y + pad * signY, { steps: 6 });
  await page.waitForTimeout(50);
  await page.mouse.up({ button: 'right' });
  await page.keyboard.up('Shift');
  await page.waitForTimeout(30);
}

test.describe('Checkboxes', () => {
  test.beforeEach(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/checkboxes.html`);
    await page.bringToFront();
  });

  test('alterna solo las casillas dentro de la caja', async ({ page }) => {
    await boxDrag(page, '#a1', '#a4');
    const s = await page.evaluate(() => window.state());
    expect(s).toMatchObject({ a1: true, a2: true, a3: false, a4: true, a5: false, 'b-activa': false, c1: false });
  });

  test('funciona en sentido inverso', async ({ page }) => {
    await boxDrag(page, '#a4', '#a2');
    expect(await page.evaluate(() => window.state())).toMatchObject({ a1: false, a2: true, a3: false, a4: true, a5: false });
  });

  test('ir y volver en el mismo arrastre alterna cada casilla una sola vez', async ({ page }) => {
    await centerView(page, '#a1');
    const a = await center(page, '#a1');
    const d = await center(page, '#a4');
    await page.keyboard.down('Shift');
    await page.mouse.move(a.x - 6, a.y - 6);
    await page.mouse.down({ button: 'right' });
    for (const y of [d.y + 6, a.y + 2, d.y + 6, a.y + 2]) {
      await page.mouse.move(a.x + 6, y, { steps: 4 });
      await page.waitForTimeout(40);
    }
    await page.mouse.up({ button: 'right' });
    await page.keyboard.up('Shift');
    expect(await page.evaluate(() => window.state())).toMatchObject({ a1: true, a2: true, a3: false, a4: true });
  });

  test('un segundo arrastre vuelve a alternar', async ({ page }) => {
    await boxDrag(page, '#a1', '#a2');
    await boxDrag(page, '#a1', '#a2');
    expect(await page.evaluate(() => window.state())).toMatchObject({ a1: false, a2: false });
  });

  test('la página recibe click, input y change, y el formulario ve el valor', async ({ page }) => {
    await boxDrag(page, '#b-activa', '#b-final');
    const log = await page.evaluate(() => window.log);
    expect(log.change).toEqual(['b-activa', 'b-final']);
    expect(log.input).toEqual(['b-activa', 'b-final']);
    const data = await page.evaluate(() => [...new FormData(document.getElementById('formulario')).keys()]);
    expect(data).toEqual(['activa', 'final']);
  });

  test('omite desactivadas y ocultas', async ({ page }) => {
    await boxDrag(page, '#b-activa', '#b-final');
    expect(await page.evaluate(() => window.state())).toMatchObject({
      'b-activa': true, 'b-disabled': false, 'b-oculta': false, 'b-invisible': false, 'b-fieldset': false, 'b-final': true,
    });
  });

  test('una casilla oculta no se marca aunque la caja cubra el origen de la página', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const b = await center(page, '#a1');
    await page.keyboard.down('Shift');
    await page.mouse.move(1, 1);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(b.x + 6, b.y + 6, { steps: 4 });
    await page.waitForTimeout(50);
    await page.mouse.up({ button: 'right' });
    await page.keyboard.up('Shift');
    expect(await page.evaluate(() => window.state())).toMatchObject({ 'b-oculta': false, a1: true });
  });

  test('si la página rechaza el clic, la casilla no cambia y las demás sí', async ({ page }) => {
    await boxDrag(page, '#d-rechaza', '#d-normal');
    expect(await page.evaluate(() => window.state())).toMatchObject({ 'd-rechaza': false, 'd-normal': true });
  });

  test('la caja se ve durante el arrastre, en su sitio, y se oculta al soltar', async ({ page }) => {
    await centerView(page, '#a1');
    const a = await center(page, '#a1');
    await page.keyboard.down('Shift');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(a.x + 120, a.y + 70, { steps: 4 });
    await page.waitForTimeout(50);
    const during = await page.$eval('#cellsel-checkbox-box', (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return { x: r.left, y: r.top, w: r.width, h: r.height, display: s.display, position: s.position };
    });
    // Tolerancia de 1 px: el ratón se mueve en coordenadas enteras y las casillas no.
    expect(during).toMatchObject({ display: 'block', position: 'fixed' });
    expect(Math.abs(during.w - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs(during.h - 70)).toBeLessThanOrEqual(1);
    expect(Math.abs(during.x - a.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(during.y - a.y)).toBeLessThanOrEqual(1);
    await page.mouse.up({ button: 'right' });
    await page.keyboard.up('Shift');
    expect(await page.$eval('#cellsel-checkbox-box', (el) => getComputedStyle(el).display)).toBe('none');
  });

  test('funciona con la página desplazada y en un contenedor con offset', async ({ page }) => {
    await boxDrag(page, '#z1', '#z2');
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    expect(await page.evaluate(() => window.state())).toMatchObject({ z1: true, z2: true, a1: false });
    await boxDrag(page, '#e1', '#e2');
    expect(await page.evaluate(() => window.state())).toMatchObject({ e1: true, e2: true });
  });

  test('desplazar la página durante el arrastre mantiene la caja anclada', async ({ page }) => {
    await centerView(page, '#a1');
    const a = await center(page, '#a1');
    await page.keyboard.down('Shift');
    await page.mouse.move(a.x - 6, a.y - 6);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(a.x + 8, a.y + 8, { steps: 3 });
    await page.evaluate(() => window.scrollBy(0, 100));
    await page.waitForTimeout(80);
    const box = await page.$eval('#cellsel-checkbox-box', (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height };
    });
    expect(Math.abs(box.top - (a.y - 6 - 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - 114)).toBeLessThanOrEqual(1);
    await page.mouse.up({ button: 'right' });
    await page.keyboard.up('Shift');
  });

  test('dentro de un iframe', async ({ page }) => {
    const frameEl = await page.$('#marco');
    const frame = await frameEl.contentFrame();
    // Centrar la casilla también desplaza la página: la posición del marco se mide después.
    await centerView(frame, '#f1');
    const origin = await frameEl.boundingBox();
    await boxDrag(page, '#f1', '#f2', { scope: frame, origin });
    expect(await frame.$eval('#f1', (c) => c.checked)).toBe(true);
    expect(await frame.$eval('#f2', (c) => c.checked)).toBe(true);
  });

  test('una página hostil no impide el arrastre ni ve sus eventos', async ({ page }) => {
    await page.evaluate(() => { window.hostileOn = true; });
    await boxDrag(page, '#a1', '#a2');
    await page.evaluate(() => { window.hostileOn = false; });
    const log = await page.evaluate(() => window.log);
    expect(log).toMatchObject({ mousedown: 0, pointerdown: 0, mouseup: 0 });
    expect(await page.evaluate(() => window.state())).toMatchObject({ a1: true, a2: true });
  });

  test('mouseup perdido: un movimiento sin botón termina el arrastre', async ({ page, browserContext }) => {
    await centerView(page, '#a1');
    const a = await center(page, '#a1');
    const e = await center(page, '#a5');
    await page.keyboard.down('Shift');
    await page.mouse.move(a.x - 6, a.y - 6);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(a.x + 6, a.y + 6, { steps: 2 });
    await page.waitForTimeout(40);
    await page.keyboard.up('Shift');
    const cdp = await browserContext.newCDPSession(page);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: e.x + 6, y: e.y + 6, button: 'none', buttons: 0 });
    await page.waitForTimeout(60);
    await page.mouse.up({ button: 'right' });
    expect(await page.$eval('#cellsel-checkbox-box', (el) => getComputedStyle(el).display)).toBe('none');
    expect(await page.evaluate(() => window.state())).toMatchObject({ a1: true, a5: false });
  });
});

test.describe('Menú contextual', () => {
  test.beforeEach(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/checkboxes.html`);
    await page.bringToFront();
  });

  test('Shift + clic derecho no abre el menú de la página', async ({ page }) => {
    await boxDrag(page, '#a1', '#a2');
    expect(await page.evaluate(() => window.log.contextmenu)).toBe(0);
  });

  test('soltar Shift antes que el botón tampoco lo abre', async ({ page }) => {
    await centerView(page, '#a1');
    const a = await center(page, '#a1');
    await page.keyboard.down('Shift');
    await page.mouse.move(a.x - 6, a.y - 6);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(a.x + 6, a.y + 6, { steps: 2 });
    await page.keyboard.up('Shift');
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(30);
    expect(await page.evaluate(() => window.log.contextmenu)).toBe(0);
  });

  test('clic derecho sin Shift funciona con normalidad', async ({ page }) => {
    await page.evaluate(() => {
      document.addEventListener('contextmenu', (e) => {
        window.menuPrevented = e.defaultPrevented;
        e.preventDefault();
      });
    });
    const p = await center(page, '#a1');
    await page.mouse.click(p.x + 40, p.y, { button: 'right' });
    expect(await page.evaluate(() => [window.log.contextmenu, window.menuPrevented])).toEqual([1, false]);
    expect(await page.evaluate(() => window.state())).toMatchObject({ a1: false });
    expect(await page.evaluate(() => document.getElementById('cellsel-checkbox-box'))).toBeNull();
  });

  test('Shift + F10 sigue abriendo el menú', async ({ page }) => {
    await page.evaluate(() => {
      document.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    await boxDrag(page, '#a1', '#a2');
    await page.waitForTimeout(300);
    await page.focus('#a1');
    await page.keyboard.press('Shift+F10');
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window.log.contextmenu)).toBe(1);
  });

  test('no añade nada al DOM hasta que se usa', async ({ page }) => {
    expect(await page.evaluate(() => document.getElementById('cellsel-checkbox-box'))).toBeNull();
  });
});

test.describe('Convivencia con el selector de celdas', () => {
  test.beforeEach(async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/checkboxes.html`);
    await page.bringToFront();
  });

  test('una caja de checkboxes conserva la selección de celdas', async ({ page }) => {
    await drag(page, '#tabla', [0, 1], [2, 2]);
    expect(await countSelected(page)).toBe(6);
    await boxDrag(page, '#c1', '#c3');
    expect(await page.evaluate(() => window.state())).toMatchObject({ c1: true, c2: true, c3: true });
    expect(await countSelected(page)).toBe(6);
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe('Fila 1\t10\nFila 2\t20\nFila 3\t30');
  });

  test('la caja dentro de una tabla no crea selección de celdas', async ({ page }) => {
    await boxDrag(page, '#c1', '#c2');
    expect(await countSelected(page)).toBe(0);
    expect(await page.evaluate(() => window.state())).toMatchObject({ c1: true, c2: true, c3: false });
  });

  test('Ctrl + arrastrar sobre celdas con casillas no las alterna', async ({ page }) => {
    await drag(page, '#tabla', [0, 1], [2, 1]);
    expect(await selectedCells(page, '#tabla')).toEqual([['Fila 1'], ['Fila 2'], ['Fila 3']]);
    expect(await page.evaluate(() => window.state())).toMatchObject({ c1: false, c2: false, c3: false });
  });

  test('un clic de casilla justo tras un arrastre de celdas no se pierde', async ({ page }) => {
    await drag(page, '#tabla', [0, 1], [1, 1]);
    await boxDrag(page, '#a1', '#a2');
    expect(await page.evaluate(() => window.state())).toMatchObject({ a1: true, a2: true });
  });

  test('pulsar Ctrl + izquierdo durante una caja no inicia selección de celdas', async ({ page }) => {
    await centerView(page, '#c1');
    const a = await center(page, '#c1');
    const c = await center(page, '#c3');
    await page.keyboard.down('Shift');
    await page.mouse.move(a.x - 6, a.y - 6);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(a.x + 6, a.y + 6, { steps: 2 });
    await page.keyboard.up('Shift');
    await page.keyboard.down('Control');
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(c.x + 60, c.y + 6, { steps: 3 });
    await page.mouse.up({ button: 'left' });
    await page.keyboard.up('Control');
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(30);
    expect(await countSelected(page)).toBe(0);
  });

  test('pulsar Shift + derecho durante un arrastre de celdas no lo rompe', async ({ page }) => {
    const box = await page.$eval('#tabla', (t) => {
      t.scrollIntoView({ block: 'center', behavior: 'instant' });
      const center = (c) => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
      return { a: center(t.rows[0].cells[1]), b: center(t.rows[2].cells[1]) };
    });
    await page.keyboard.down('Control');
    await page.mouse.move(box.a.x, box.a.y);
    await page.mouse.down();
    await page.mouse.move(box.a.x, box.a.y + 10, { steps: 2 });
    await page.keyboard.down('Shift');
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await page.keyboard.up('Shift');
    await page.mouse.move(box.b.x, box.b.y, { steps: 3 });
    await page.waitForTimeout(40);
    await page.mouse.up();
    await page.keyboard.up('Control');
    expect(await selectedCells(page, '#tabla')).toEqual([['Fila 1'], ['Fila 2'], ['Fila 3']]);
    expect(await page.evaluate(() => window.state())).toMatchObject({ c1: false, c2: false, c3: false });
  });
});

test.describe('Rendimiento de checkboxes', () => {
  test('5000 casillas: un arrastre las alterna todas sin bloquear', async ({ page, baseUrl }) => {
    await page.goto(`${baseUrl}/otra.html`);
    await page.bringToFront();
    await page.evaluate(() => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:grid;grid-template-columns:repeat(100,12px);gap:0';
      wrap.innerHTML = Array.from({ length: 5000 }, (_, i) => `<input type="checkbox" id="m${i}" style="margin:0;width:10px;height:10px">`).join('');
      document.body.appendChild(wrap);
    });
    const a = await center(page, '#m0');
    const b = await center(page, '#m4999');
    const started = Date.now();
    await page.keyboard.down('Shift');
    await page.mouse.move(a.x - 3, a.y - 3);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(b.x + 3, b.y + 3, { steps: 20 });
    await page.mouse.up({ button: 'right' });
    await page.keyboard.up('Shift');
    const elapsed = Date.now() - started;
    const checked = await page.evaluate(() => document.querySelectorAll('input:checked').length);
    console.log(JSON.stringify({ checkboxes: 5000, checked, elapsedMs: elapsed }));
    expect(checked).toBe(5000);
    expect(elapsed).toBeLessThan(3000);
  });
});

test.describe('Migración desde la extensión original', () => {
  test.skip(!fs.existsSync(ORIGINAL_ZIP), 'falta checkbox-ruanox_firefox.zip');

  async function runScenario(page, baseUrl) {
    await page.goto(`${baseUrl}/checkboxes.html`);
    await page.bringToFront();
    await boxDrag(page, '#a1', '#a4');
    await boxDrag(page, '#a4', '#a5');
    await boxDrag(page, '#c1', '#c3');
    await boxDrag(page, '#z1', '#z2');
    const state = await page.evaluate(() => window.state());
    const change = await page.evaluate(() => window.log.change.length);
    return { state, change };
  }

  test('misma selección que la extensión original en el escenario común', async ({ page, baseUrl }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkbox-original-'));
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${ORIGINAL_ZIP}' -DestinationPath '${dir}'`]);
    const original = await launch({ extensionPath: dir });
    let before;
    try {
      const origPage = await original.context.newPage();
      before = await runScenario(origPage, baseUrl);
    } finally {
      await original.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const after = await runScenario(page, baseUrl);
    expect(after.state).toEqual(before.state);
    // La diferencia buscada: la original no avisa a la página; la nueva, sí.
    expect(before.change).toBe(0);
    expect(after.change).toBeGreaterThan(0);
  });
});
