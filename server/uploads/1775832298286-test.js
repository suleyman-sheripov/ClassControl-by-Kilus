const { app } = require('electron');
console.log('[TEST] app:', app ? 'defined' : 'undefined');
if (app) {
  app.on('ready', () => {
    console.log('[TEST] app is ready');
    app.quit();
  });
} else {
  console.log('[TEST] require("electron") value:', require('electron'));
}
