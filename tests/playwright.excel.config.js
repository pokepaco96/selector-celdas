const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './specs',
  testMatch: /excel\.spec\.js/,
  workers: 1,
  timeout: 120000,
  // Se ejecuta con ventana: el cursor físico de Windows puede mezclarse con el simulado.
  retries: 1,
  reporter: [['list'], ['json', { outputFile: 'resultados/resultados-excel.json' }]],
  outputDir: 'resultados/artefactos-excel',
});
