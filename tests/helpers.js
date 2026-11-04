const { test: base, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PAGES_DIR = path.join(__dirname, 'pages');
const EXTENSION_PATH = process.env.EXTENSION_PATH || path.join(__dirname, '..', 'extension');
const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL || 'chromium';
const SENTINEL = '__CENTINELA__';

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const name = path.basename(new URL(req.url, 'http://x').pathname);
      const file = path.join(PAGES_DIR, name);
      if (!fs.existsSync(file) || !name.endsWith('.html')) {
        res.writeHead(name === 'favicon.ico' ? 204 : 404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function launch({ withExtension = true, headless = !process.env.HEADED, extensionPath = EXTENSION_PATH } = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selector-celdas-'));
  const args = ['--host-resolver-rules=MAP celdas.test 127.0.0.1'];
  // Google Chrome ya no admite --load-extension: se instala por CDP (BROWSER_CHANNEL=chrome).
  const isChrome = BROWSER_CHANNEL === 'chrome';
  if (withExtension && isChrome) {
    args.push('--enable-unsafe-extension-debugging');
  } else if (withExtension) {
    args.push(`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`);
  }
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: BROWSER_CHANNEL,
    headless,
    viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ['--hide-scrollbars', ...(isChrome ? ['--disable-extensions'] : [])],
    args,
  });
  if (withExtension && isChrome) {
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
  }
  return {
    context,
    close: async () => {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

const test = base.extend({
  server: [async ({}, use) => {
    const server = await startServer();
    await use(server);
    server.close();
  }, { scope: 'worker' }],

  baseUrl: [async ({ server }, use) => {
    await use(`http://localhost:${server.address().port}`);
  }, { scope: 'worker' }],

  browserContext: [async ({ baseUrl }, use) => {
    const { context, close } = await launch();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });
    await use(context);
    await close();
  }, { scope: 'worker' }],

  // Página de pruebas limpia, con el portapapeles marcado para detectar copias que
  // no se hayan producido, y fallo automático si aparecen errores en la consola.
  page: async ({ browserContext, baseUrl }, use) => {
    const page = await browserContext.newPage();
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') errors.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.consoleErrors = errors;
    await page.goto(`${baseUrl}/pruebas.html`);
    await page.bringToFront();
    await writeSentinel(page);
    await use(page);
    expect(errors, 'la consola no debe registrar errores ni avisos').toEqual([]);
    await page.close();
  },
});

async function writeSentinel(page) {
  await page.evaluate((text) => navigator.clipboard.writeText(text), SENTINEL);
}

async function readClipboard(page) {
  await page.bringToFront();
  return page.evaluate(async () => {
    const out = { types: [], text: null, html: null };
    for (const item of await navigator.clipboard.read()) {
      for (const type of item.types) {
        out.types.push(type);
        const text = await (await item.getType(type)).text();
        if (type === 'text/plain') out.text = text;
        if (type === 'text/html') out.html = text;
      }
    }
    return out;
  });
}

// Convierte el HTML del portapapeles en filas de { tag, text, rowspan, colspan }.
async function parseClipboardTable(page, html) {
  return page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    return {
      tables: doc.querySelectorAll('table').length,
      rows: [...doc.querySelectorAll('tr')].map((tr) => [...tr.cells].map((cell) => ({
        tag: cell.localName,
        text: cell.textContent,
        rowspan: cell.rowSpan,
        colspan: cell.colSpan,
      }))),
    };
  }, html);
}

function htmlTexts(parsed) {
  return parsed.rows.map((row) => row.map((cell) => cell.text));
}

// Centro de table.rows[r].cells[c]. `table` es un selector o un manejador de elemento.
async function cellCenter(scope, table, r, c, { scroll = true } = {}) {
  const handle = typeof table === 'string' ? await scope.$(table) : table;
  return handle.evaluate((el, [row, col, doScroll]) => {
    const cell = el.rows[row].cells[col];
    if (doScroll) cell.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = cell.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, [r, c, scroll]);
}

// Arrastre real con el ratón entre dos celdas, en el mismo sistema de coordenadas.
async function drag(page, table, from, to, { modifier = 'Control', scope = page, offset = { x: 0, y: 0 } } = {}) {
  const start = await cellCenter(scope, table, from[0], from[1]);
  const end = await cellCenter(scope, table, to[0], to[1], { scroll: false });
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(start.x + offset.x, start.y + offset.y);
  await page.mouse.down();
  await page.mouse.move(end.x + offset.x, end.y + offset.y, { steps: 8 });
  await page.waitForTimeout(40);
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

async function ctrlClick(page, table, r, c) {
  const point = await cellCenter(page, table, r, c);
  await page.keyboard.down('Control');
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up('Control');
}

// Texto de las celdas resaltadas, agrupado por fila. Admite selector de tabla o manejador.
async function selectedCells(scope, table) {
  const handle = typeof table === 'string' ? await scope.$(table) : table;
  return handle.evaluate((el) => [...el.rows]
    .map((row) => [...row.cells].filter((cell) => cell.hasAttribute('data-cellsel')).map((cell) => cell.textContent.trim()))
    .filter((row) => row.length));
}

async function countSelected(page) {
  return page.evaluate(() => document.querySelectorAll('[data-cellsel]').length);
}

async function pressCopy(page) {
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(30);
}

module.exports = {
  test, expect, launch, startServer, SENTINEL, writeSentinel, readClipboard, parseClipboardTable,
  htmlTexts, cellCenter, drag, ctrlClick, selectedCells, countSelected, pressCopy,
};
