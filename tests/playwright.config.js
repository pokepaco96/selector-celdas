const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './specs',
  testIgnore: /excel/,
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  // Con ventana, el cursor físico de Windows puede mezclarse con el ratón simulado.
  retries: process.env.HEADED ? 1 : 0,
  reporter: [['list'], ['json', { outputFile: 'resultados/resultados.json' }]],
  outputDir: 'resultados/artefactos',
});
