const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { startServer } = require('../server/app');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

let mainWindow = null;
let serverHandle = null;

const HOST = process.env.HOST || '127.0.0.1';
const BASE_PORT = Number(process.env.PORT) || 3330;
const OPEN_DEVTOOLS =
  process.argv.includes('--devtools') || process.env.ELECTRON_OPEN_DEVTOOLS === '1';

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(url);

  if (OPEN_DEVTOOLS) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

async function startBackend(retries = 10) {
  let port = BASE_PORT;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      serverHandle = await startServer({ port, host: HOST });
      return serverHandle;
    } catch (error) {
      if (error && error.code === 'EADDRINUSE' && attempt < retries) {
        port += 1;
      } else {
        throw error;
      }
    }
  }
  return serverHandle;
}

async function init() {
  await app.whenReady();
  try {
    const { port } = await startBackend();
    const url = `http://${HOST}:${port}`;
    console.log(`nexus-rag (electron) -> ${url}`);
    createWindow(url);
  } catch (error) {
    console.error('[electron] no se pudo arrancar el backend:', error);
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverHandle) {
      createWindow(`http://${HOST}:${serverHandle.port}`);
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  if (serverHandle) {
    event.preventDefault();
    const handle = serverHandle;
    serverHandle = null;
    try {
      await handle.close();
    } catch (error) {
      console.error('[electron] error cerrando backend:', error);
    } finally {
      app.exit(0);
    }
  }
});

init();
