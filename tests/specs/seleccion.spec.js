const {
  test, expect, readClipboard, parseClipboardTable, htmlTexts, drag, ctrlClick,
  selectedCells, countSelected, pressCopy, cellCenter,
} = require('../helpers');

async function copied(page) {
  await pressCopy(page);
  const clip = await readClipboard(page);
  expect(clip.types).toEqual(expect.arrayContaining(['text/plain', 'text/html']));
  const parsed = await parseClipboardTable(page, clip.html);
  expect(parsed.tables).toBe(1);
  return { text: clip.text, html: parsed, htmlTexts: htmlTexts(parsed) };
}

test.describe('Selección y copia básicas', () => {
  test('tabla 1: selección vertical de una sola columna', async ({ page }) => {
    await drag(page, '#t1', [0, 0], [3, 0]);
    expect(await selectedCells(page, '#t1')).toEqual([['Manzana'], ['Pera'], ['Uva'], ['Kiwi']]);
    const { text, htmlTexts: h } = await copied(page);
    expect(text).toBe('Manzana\nPera\nUva\nKiwi');
    expect(h).toEqual([['Manzana'], ['Pera'], ['Uva'], ['Kiwi']]);
  });

  test('tabla 2: copiar una columna no añade columnas', async ({ page }) => {
    await drag(page, '#t2', [1, 1], [4, 1]);
    expect(await selectedCells(page, '#t2')).toEqual([['Madrid'], ['Sevilla'], ['Bilbao'], ['Cádiz']]);
    const { text, html } = await copied(page);
    expect(text).toBe('Madrid\nSevilla\nBilbao\nCádiz');
    expect(text).not.toContain('\t');
    expect(html.rows.every((row) => row.length === 1)).toBe(true);
  });

  test('tabla 2: selección horizontal de una fila', async ({ page }) => {
    await drag(page, '#t2', [2, 0], [2, 1]);
    expect(await selectedCells(page, '#t2')).toEqual([['Luis', 'Sevilla']]);
    const { text, htmlTexts: h } = await copied(page);
    expect(text).toBe('Luis\tSevilla');
    expect(h).toEqual([['Luis', 'Sevilla']]);
  });

  test('tabla 2: bloque rectangular con cabecera', async ({ page }) => {
    await drag(page, '#t2', [0, 0], [2, 1]);
    const { text, html } = await copied(page);
    expect(text).toBe('Nombre\tCiudad\nAna\tMadrid\nLuis\tSevilla');
    expect(html.rows[0].map((c) => c.tag)).toEqual(['th', 'th']);
    expect(html.rows[1].map((c) => c.tag)).toEqual(['td', 'td']);
  });

  test('arrastre inverso (de abajo arriba y de derecha a izquierda)', async ({ page }) => {
    await drag(page, '#t2', [3, 1], [1, 0]);
    const { text } = await copied(page);
    expect(text).toBe('Ana\tMadrid\nLuis\tSevilla\nMarta\tBilbao');
    const marks = await page.$eval('#t2', (t) => ({
      start: t.rows[3].cells[1].getAttribute('data-cellsel'),
      end: t.rows[1].cells[0].getAttribute('data-cellsel'),
    }));
    expect(marks).toEqual({ start: 'start', end: 'end' });
  });

  test('tabla 3: diez filas de la columna de enlaces, copia el texto', async ({ page }) => {
    await drag(page, '#t3', [0, 1], [9, 1]);
    const { text, html } = await copied(page);
    expect(text).toBe(Array.from({ length: 10 }, (_, i) => `Enlace ${i + 1}`).join('\n'));
    expect(html.rows.every((row) => row.length === 1)).toBe(true);
    expect(page.url()).toContain('pruebas.html');
  });

  test('tabla 3: columna de datos sin enlaces', async ({ page }) => {
    await drag(page, '#t3', [0, 2], [9, 2]);
    const { text } = await copied(page);
    expect(text).toBe('10\n20\n30\n40\n50\n60\n70\n80\n90\n100');
  });

  test('tabla 4: elementos anidados, oculto y decorativo excluidos', async ({ page }) => {
    await drag(page, '#t4', [0, 0], [0, 2]);
    const { text } = await copied(page);
    expect(text).toBe('Informe anual\tTotal: 1.234,50 €\tcon imagen');
    expect(text).not.toContain('OCULTO');
    expect(text).not.toContain('★');
    expect(text).not.toContain(' ');
  });

  test('tabla 4: saltos internos no rompen la fila y el HTML queda escapado', async ({ page }) => {
    await drag(page, '#t4', [1, 0], [2, 2]);
    const { text, htmlTexts: h } = await copied(page);
    expect(text).toBe('Memoria\tLínea uno Línea dos\tUno Dos\nTom & Jerry <b>\t"entre comillas"\t');
    expect(h).toEqual([
      ['Memoria', 'Línea uno Línea dos', 'Uno Dos'],
      ['Tom & Jerry <b>', '"entre comillas"', ''],
    ]);
  });

  test('tabla 4: el resaltado se ve aunque un hijo tenga fondo opaco', async ({ page }) => {
    await ctrlClick(page, '#t4', 0, 1);
    const colors = await page.$eval('#t4', (t) => {
      const cell = t.rows[0].cells[1];
      return {
        cell: getComputedStyle(cell).backgroundColor,
        child: getComputedStyle(cell.querySelector('.fondo-opaco')).backgroundColor,
      };
    });
    expect(colors.cell).toBe('rgba(66, 133, 244, 0.3)');
    expect(colors.child).toBe('rgba(0, 0, 0, 0)');
  });

  test('tabla 5: user-select none', async ({ page }) => {
    await drag(page, '#t5', [0, 1], [2, 1]);
    const { text } = await copied(page);
    expect(text).toBe('seleccionable\nprotegido\nfila');
  });

  test('Ctrl + clic selecciona una celda y repetirlo la deselecciona', async ({ page }) => {
    await ctrlClick(page, '#t1', 2, 0);
    expect(await selectedCells(page, '#t1')).toEqual([['Uva']]);
    const { text } = await copied(page);
    expect(text).toBe('Uva');
    await ctrlClick(page, '#t1', 2, 0);
    expect(await countSelected(page)).toBe(0);
  });

  test('un arrastre nuevo sustituye a la selección anterior', async ({ page }) => {
    await drag(page, '#t1', [0, 0], [1, 0]);
    await drag(page, '#t2', [1, 0], [2, 0]);
    expect(await selectedCells(page, '#t1')).toEqual([]);
    const { text } = await copied(page);
    expect(text).toBe('Ana\nLuis');
  });

  test('la selección permanece visible tras soltar', async ({ page }) => {
    await drag(page, '#t1', [0, 0], [2, 0]);
    await page.waitForTimeout(300);
    expect(await countSelected(page)).toBe(3);
    const style = await page.$eval('#t1', (t) => getComputedStyle(t.rows[1].cells[0]).backgroundColor);
    expect(style).toBe('rgba(66, 133, 244, 0.3)');
  });

  test('se marcan claramente el inicio y el final', async ({ page }) => {
    await drag(page, '#t1', [0, 0], [2, 0]);
    const info = await page.$eval('#t1', (t) => [0, 1, 2].map((r) => {
      const cell = t.rows[r].cells[0];
      return [cell.getAttribute('data-cellsel'), getComputedStyle(cell).boxShadow];
    }));
    expect(info[0][0]).toBe('start');
    expect(info[1][0]).toBe('on');
    expect(info[2][0]).toBe('end');
    expect(info[0][1]).not.toBe(info[2][1]);
    expect(info[0][1]).not.toBe(info[1][1]);
  });

  test('Escape cancela la selección y no se copia nada', async ({ page }) => {
    await drag(page, '#t1', [0, 0], [2, 0]);
    expect(await countSelected(page)).toBe(3);
    await page.keyboard.press('Escape');
    expect(await countSelected(page)).toBe(0);
    await pressCopy(page);
    expect((await readClipboard(page)).text).toBe('__CENTINELA__');
  });

  test('Escape durante el arrastre cancela y no reactiva la selección', async ({ page }) => {
    const start = await cellCenter(page, '#t1', 0, 0);
    const end = await cellCenter(page, '#t1', 3, 0, { scroll: false });
    await page.keyboard.down('Control');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.waitForTimeout(40);
    expect(await countSelected(page)).toBe(4);
    await page.keyboard.press('Escape');
    expect(await countSelected(page)).toBe(0);
    await page.mouse.move(start.x, start.y, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    expect(await countSelected(page)).toBe(0);
  });
});

test.describe('rowspan, colspan y estructuras complejas', () => {
  test('tabla 6: columna a través de un colspan se queda en una columna', async ({ page }) => {
    await drag(page, '#t6', [1, 1], [4, 1]);
    const { text, html } = await copied(page);
    expect(text).toBe('B\nD\nF\nI');
    expect(html.rows.every((row) => row.length === 1 && row[0].colspan === 1)).toBe(true);
  });

  test('tabla 6: columna con rowspan conserva el hueco y la combinación', async ({ page }) => {
    await drag(page, '#t6', [1, 0], [4, 0]);
    const { text, html } = await copied(page);
    expect(text).toBe('A\n\nF\nH');
    expect(html.rows[0][0]).toMatchObject({ text: 'A', rowspan: 2, colspan: 1 });
    expect(html.rows[1]).toEqual([]);
    expect(html.rows[2][0]).toMatchObject({ text: 'F', colspan: 1 });
  });

  test('tabla 6: bloque completo mantiene la forma', async ({ page }) => {
    await drag(page, '#t6', [0, 0], [4, 2]);
    const { text, html } = await copied(page);
    expect(text).toBe('H1\tH2\tH3\nA\tB\tC\n\tD\tE\nF\t\tG\nH\tI\tJ');
    expect(html.rows[1][0]).toMatchObject({ text: 'A', rowspan: 2 });
    expect(html.rows[3][0]).toMatchObject({ text: 'F', colspan: 2 });
  });

  test('tabla 6: empezar en una celda combinada incluye toda su extensión', async ({ page }) => {
    await drag(page, '#t6', [3, 0], [4, 0]);
    const { text } = await copied(page);
    expect(text).toBe('F\t\nH\tI');
  });

  test('tablas anidadas: la interior no se mezcla con la exterior', async ({ page }) => {
    await drag(page, '#t10-inner', [0, 1], [1, 1]);
    expect(await selectedCells(page, '#t10-inner')).toEqual([['Int-2'], ['Int-4']]);
    const { text } = await copied(page);
    expect(text).toBe('Int-2\nInt-4');
  });

  test('tablas anidadas: arrastre en la exterior que pasa sobre la interior', async ({ page }) => {
    await drag(page, '#t10', [0, 0], [2, 0]);
    expect((await copied(page)).text).toBe('Ext-1\nExt-3\nExt-5');
    await drag(page, '#t10', [0, 1], [2, 1]);
    expect((await copied(page)).text).toBe('Ext-2\nInt-1 Int-2 Int-3 Int-4\nExt-6');
    expect(await selectedCells(page, '#t10-inner')).toEqual([]);
  });

  test('filas y columnas ocultas no se copian', async ({ page }) => {
    await drag(page, '#t11', [0, 0], [2, 2]);
    const { text } = await copied(page);
    expect(text).toBe('V-1\tV-2\nV-3\tV-4');
  });

  test('tabla dentro de Shadow DOM abierto', async ({ page }) => {
    const table = await page.evaluateHandle(() => document.getElementById('shadow-host').shadowRoot.getElementById('ts'));
    await drag(page, table, [0, 1], [1, 1]);
    expect(await selectedCells(page, table)).toEqual([['S-2'], ['S-4']]);
    const bg = await table.evaluate((t) => getComputedStyle(t.rows[0].cells[1]).backgroundColor);
    expect(bg).toBe('rgba(66, 133, 244, 0.3)');
    const { text } = await copied(page);
    expect(text).toBe('S-2\nS-4');
  });

  test('tabla dentro de un iframe', async ({ page }) => {
    const frameEl = await page.$('#marco');
    await frameEl.scrollIntoViewIfNeeded();
    await frameEl.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const frame = await frameEl.contentFrame();
    const box = await frameEl.boundingBox();
    const points = await frame.$eval('#tf', (t) => [t.rows[0].cells[0], t.rows[1].cells[0]].map((c) => {
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }));
    await page.keyboard.down('Control');
    await page.mouse.move(box.x + points[0].x, box.y + points[0].y);
    await page.mouse.down();
    await page.mouse.move(box.x + points[1].x, box.y + points[1].y, { steps: 5 });
    await page.waitForTimeout(40);
    await page.mouse.up();
    await page.keyboard.up('Control');
    expect(await selectedCells(frame, '#tf')).toEqual([['IF-1'], ['IF-3']]);
    await pressCopy(page);
    const clip = await readClipboard(page);
    expect(clip.text).toBe('IF-1\nIF-3');
  });
});
