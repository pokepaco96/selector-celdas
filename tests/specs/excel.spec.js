// Pegado real en Microsoft Excel. Usa el portapapeles del sistema, por lo que Chromium
// se ejecuta con ventana y lo que hubiera en el portapapeles se sobrescribe.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, launch, startServer, drag, pressCopy } = require('../helpers');

const SCRIPT = path.join(__dirname, '..', 'excel-pegar.ps1');

// Pega en una instancia oculta e independiente de Excel y devuelve las celdas.
function pasteInExcel(mode) {
  const out = path.join(os.tmpdir(), `selector-celdas-excel-${Date.now()}.json`);
  execFileSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Mode', mode, '-Out', out], {
    timeout: 90000,
    stdio: 'pipe',
  });
  const result = JSON.parse(fs.readFileSync(out, 'utf8').replace(/^﻿/, ''));
  fs.rmSync(out, { force: true });
  return result;
}

test.describe.configure({ mode: 'serial' });

test.describe('Pegado real en Excel', () => {
  let server;
  let browser;
  let page;

  test.beforeAll(async () => {
    server = await startServer();
    browser = await launch({ headless: false });
    page = await browser.context.newPage();
    await page.goto(`http://localhost:${server.address().port}/pruebas.html`);
    await page.bringToFront();
  });

  test.afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  async function copyAndPaste(table, from, to, mode) {
    await drag(page, table, from, to);
    await pressCopy(page);
    await page.keyboard.press('Escape');
    return pasteInExcel(mode);
  }

  test('una columna ocupa una sola columna', async () => {
    const r = await copyAndPaste('#t2', [1, 1], [4, 1], 'Html');
    expect(r.Columns).toBe(1);
    expect(r.Rows).toBe(4);
    expect(r.Cells).toEqual([['Madrid'], ['Sevilla'], ['Bilbao'], ['Cádiz']]);
  });

  test('un bloque conserva filas y columnas', async () => {
    const r = await copyAndPaste('#t2', [0, 0], [2, 1], 'Html');
    expect(r.Columns).toBe(2);
    expect(r.Rows).toBe(3);
    expect(r.Cells).toEqual([['Nombre', 'Ciudad'], ['Ana', 'Madrid'], ['Luis', 'Sevilla']]);
  });

  test('columna de enlaces: pega el texto', async () => {
    const r = await copyAndPaste('#t3', [0, 1], [9, 1], 'Html');
    expect(r.Columns).toBe(1);
    expect(r.Rows).toBe(10);
    expect(r.Cells[9]).toEqual(['Enlace 10']);
  });

  test('colspan y rowspan conservan la disposición', async () => {
    const r = await copyAndPaste('#t6', [0, 0], [4, 2], 'Html');
    expect(r.Columns).toBe(3);
    expect(r.Rows).toBe(5);
    expect(r.Cells[1]).toEqual(['A', 'B', 'C']);
    expect(r.Cells[2]).toEqual(['', 'D', 'E']);
    expect(r.Cells[3]).toEqual(['F', '', 'G']);
    expect(r.Cells[4]).toEqual(['H', 'I', 'J']);
  });

  test('columna a través de un colspan sigue siendo una columna', async () => {
    const r = await copyAndPaste('#t6', [1, 1], [4, 1], 'Html');
    expect(r.Columns).toBe(1);
    expect(r.Cells).toEqual([['B'], ['D'], ['F'], ['I']]);
  });

  test('texto nativo y símbolos: comillas, ampersand y etiquetas', async () => {
    const r = await copyAndPaste('#t4', [2, 0], [2, 1], 'Html');
    expect(r.Columns).toBe(2);
    expect(r.Cells).toEqual([['Tom & Jerry <b>', '"entre comillas"']]);
  });

  test('pegado solo como texto (text/plain)', async () => {
    const r = await copyAndPaste('#t2', [1, 0], [3, 1], 'Text');
    expect(r.Columns).toBe(2);
    expect(r.Rows).toBe(3);
    expect(r.Cells).toEqual([['Ana', 'Madrid'], ['Luis', 'Sevilla'], ['Marta', 'Bilbao']]);
  });

  test('valores numéricos llegan como números', async () => {
    const r = await copyAndPaste('#t3', [0, 2], [2, 2], 'Html');
    expect(r.Columns).toBe(1);
    expect(r.Values).toEqual([[10], [20], [30]]);
  });

  test('el texto con forma de fórmula no se evalúa y los números siguen siéndolo', async () => {
    const r = await copyAndPaste('#t16', [0, 0], [0, 3], 'Html');
    expect(r.Values).toEqual([['=1+1', '+1+1', '@SUMA(1)', -5]]);
  });

  test('observación: pegado como texto de fórmulas y comillas', async () => {
    const formula = await copyAndPaste('#t16', [0, 0], [0, 0], 'Text');
    const quotes = await copyAndPaste('#t4', [2, 1], [2, 1], 'Text');
    console.log('Excel como texto:', JSON.stringify({ formula: formula.Values, quotes: quotes.Values }));
  });

  test('observación: cómo interpreta Excel ceros a la izquierda y fechas', async () => {
    const r = await copyAndPaste('#t16', [0, 4], [0, 6], 'Html');
    console.log('Excel interpreta:', JSON.stringify({ Cells: r.Cells, Values: r.Values }));
    expect(r.Columns).toBe(3);
  });
});
