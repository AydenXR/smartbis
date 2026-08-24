import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !!process.env.ELECTRON_IS_DEV;
const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:5173';
const updateUrl = process.env.SMARTBIS_UPDATE_URL || 'https://62.169.16.115/updates';

if (updateUrl.startsWith('https://')) {
  app.commandLine.appendSwitch('ignore-certificate-errors');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#0c2a47',
    titleBarStyle: 'hiddenInset',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);

  if (isDev) {
    win.loadURL(startUrl);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  autoUpdater.checkForUpdatesAndNotify();

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('app:runtime', {
      isDesktop: true,
      apiBase: process.env.SMARTBIS_API_BASE || 'http://localhost:3001',
      isDev,
    });
  });

  return win;
}

app.whenReady().then(() => {
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: updateUrl,
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('app:check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdatesAndNotify();
    return { ok: true, result: !!result };
  } catch (error) {
    return { ok: false, message: error?.message || 'No se pudo verificar actualizaciones' };
  }
});

ipcMain.handle('app:restart-and-update', async () => {
  try {
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error?.message || 'No se pudo actualizar' };
  }
});

autoUpdater.on('checking-for-update', () => {
  console.log('[updater] checking-for-update');
});

autoUpdater.on('update-available', (info) => {
  console.log('[updater] update-available', info.version);
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('app:update-available', { version: info.version });
  }
});

autoUpdater.on('update-not-available', () => {
  console.log('[updater] update-not-available');
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('app:update-not-available');
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('app:update-progress', progressObj);
  }
});

autoUpdater.on('update-downloaded', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('app:update-downloaded');
  }
});

autoUpdater.on('error', (error) => {
  console.error('[updater] error', error);
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('app:update-error', { message: error?.message || 'Actualización fallida' });
  }
});

app.on('certificate-error', (event, _webContents, url, error, certificate, callback) => {
  if (url.startsWith('https://127.0.0.1') || url.startsWith('http://localhost')) {
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
});
