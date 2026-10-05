import { app, BrowserWindow, ipcMain } from 'electron';
import electronUpdater from 'electron-updater';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { autoUpdater } = electronUpdater;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const installDir = path.dirname(process.execPath);
const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = path.join(installDir, `smartbis-session-${sessionId}.log`);
const logLines = [];

function loadRuntimeEnvFile() {
  const candidates = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(installDir, '.env.local'),
    path.resolve(process.resourcesPath || installDir, 'app.asar', '.env.local'),
    path.resolve(__dirname, '..', '.env.local'),
  ];

  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) {
    logLines.push(`[${new Date().toISOString()}] runtime-env missing candidates=${candidates.join('|')}\n`);
    return;
  }

  const result = dotenv.config({ path: found, override: true });
  logLines.push(`[${new Date().toISOString()}] runtime-env loaded file=${found} error=${result.error?.message || 'none'}\n`);
}

loadRuntimeEnvFile();

function logLine(line) {
  const stamp = new Date().toISOString();
  const text = `[${stamp}] ${line}\n`;
  logLines.push(text);
  try {
    fs.appendFileSync(logPath, text, 'utf8');
  } catch (error) {
    console.error('[smartbis-log] write failed', error);
  }
}

function logRuntimeMetadata() {
  logLine(`startup appVersion=${app.getVersion()} isDev=${!!process.env.ELECTRON_IS_DEV} execPath=${process.execPath}`);
  logLine(`startup cwd=${process.cwd()} baseDir=${__dirname} installDir=${installDir}`);
  logLine(`startup startUrl=${process.env.ELECTRON_START_URL || 'http://localhost:5173'}`);
  logLine(`startup updateUrl=${process.env.SMARTBIS_UPDATE_URL || 'https://updates.smartbis.ai/updates'}`);
}

const isDev = !!process.env.ELECTRON_IS_DEV;
const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:5173';
const updateUrl = process.env.SMARTBIS_UPDATE_URL || 'https://updates.smartbis.ai/updates';

if (updateUrl.startsWith('https://')) {
  app.commandLine.appendSwitch('ignore-certificate-errors');
}

ipcMain.on('app:log', (_event, message) => {
  logLine(`renderer-log ${String(message)}`);
});

// ============================================================
//  CONFIGURACION UPDATER (ANTES DE CUALQUIER createWindow)
//  EVITA RACE CONDITION: settings se aplican ANTES de checkear
// ============================================================
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
try {
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: updateUrl,
  });
} catch (_) {}

let latestUpdateInfo = null;
let updateDownloaded = false;
let runtimeWindowReady = false;
let userDeclinedSessionVersion = null;

function parseSemver(v) {
  if (!v || typeof v !== 'string') return [-1, -1, -1];
  const parts = String(v).split(/[.-]/).slice(0, 3).map(x => parseInt(String(x || '0'), 10) || 0);
  while (parts.length < 3) parts.push(0);
  return [parts[0], parts[1], parts[2]];
}

function isVersionGreater(remoteVersion, localVersion) {
  const r = parseSemver(remoteVersion);
  const l = parseSemver(localVersion);
  for (let i = 0; i < 3; i += 1) {
    if (r[i] > l[i]) return true;
    if (r[i] < l[i]) return false;
  }
  return false;
}

function sendToRenderer(channel, payload) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    try {
      win.webContents.send(channel, payload);
    } catch (_) {}
  }
}

function notifyUpdateAvailable() {
  if (!latestUpdateInfo) return;
  const installed = app.getVersion();
  const remote = latestUpdateInfo.version;
  if (!isVersionGreater(remote, installed)) {
    logLine(`[updater] notify skipped: remota ${remote} no mayor a instalada ${installed}`);
    latestUpdateInfo = null;
    return;
  }
  if (userDeclinedSessionVersion === remote) return;
  sendToRenderer('app:update-available', {
    version: remote,
    downloaded: updateDownloaded,
    installed,
  });
}

async function checkForUpdatesIfReady() {
  if (!runtimeWindowReady) return;
  try {
    const installed = app.getVersion();
    const result = await autoUpdater.checkForUpdates();
    logLine(`updater checkForUpdates result: ${result ? 'server-version=' + result.updateInfo.version : 'none'} installed=${installed}`);
    if (result && result.updateInfo && isVersionGreater(result.updateInfo.version, installed)) {
      latestUpdateInfo = result.updateInfo;
      notifyUpdateAvailable();
    } else if (result && result.updateInfo) {
      logLine(`[updater] skip update: remota ${result.updateInfo.version} no mayor a ${installed}, limpiando latestUpdateInfo`);
      latestUpdateInfo = null;
    }
  } catch (error) {
    logLine(`updater checkForUpdates error: ${error?.message || error}`);
  }
}

autoUpdater.on('checking-for-update', () => {
  logLine('[updater] checking-for-update');
});

autoUpdater.on('update-available', (info) => {
  const installed = app.getVersion();
  const remote = info?.version;
  logLine(`[updater] update-available event remota=${remote} instalada=${installed}`);
  if (isVersionGreater(remote, installed)) {
    latestUpdateInfo = info;
    if (runtimeWindowReady) notifyUpdateAvailable();
  } else {
    logLine(`[updater] update-available IGNORADO: remota ${remote} no > ${installed}, limpiando latestUpdateInfo`);
    latestUpdateInfo = null;
  }
});

autoUpdater.on('update-not-available', () => {
  logLine('[updater] update-not-available');
  latestUpdateInfo = null;
  sendToRenderer('app:update-not-available');
});

autoUpdater.on('download-progress', (progressObj) => {
  sendToRenderer('app:update-progress', progressObj);
});

autoUpdater.on('update-downloaded', () => {
  updateDownloaded = true;
  logLine('[updater] update-downloaded ready');
  notifyUpdateAvailable();
});

autoUpdater.on('error', (error) => {
  logLine(`[updater] error ${error?.message || error}`);
  sendToRenderer('app:update-error', { message: error?.message || 'Actualización fallida' });
});

ipcMain.handle('app:check-for-updates', async () => {
  try {
    runtimeWindowReady = true;
    const installed = app.getVersion();
    const result = await autoUpdater.checkForUpdates();
    const remote = result?.updateInfo?.version || null;
    const isReallyAvailable = !!(result && result.updateInfo && isVersionGreater(remote, installed));
    logLine(`[ipc check-for-updates] installed=${installed} server=${remote} available=${isReallyAvailable}`);
    if (isReallyAvailable) {
      latestUpdateInfo = result.updateInfo;
      if (userDeclinedSessionVersion !== remote) notifyUpdateAvailable();
    } else {
      latestUpdateInfo = null;
    }
    return { ok: true, updateAvailable: isReallyAvailable, version: isReallyAvailable ? remote : null, downloaded: isReallyAvailable && updateDownloaded, installed };
  } catch (error) {
    return { ok: false, message: error?.message || 'No se pudo verificar actualizaciones' };
  }
});

ipcMain.handle('app:restart-and-update', async () => {
  try {
    const installed = app.getVersion();
    if (!latestUpdateInfo || !isVersionGreater(latestUpdateInfo.version, installed) || !updateDownloaded) {
      return { ok: false, message: 'No hay actualización válida descargada para instalar' };
    }
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error?.message || 'No se pudo actualizar' };
  }
});

ipcMain.handle('app:download-update', async () => {
  try {
    const installed = app.getVersion();
    if (!latestUpdateInfo || !isVersionGreater(latestUpdateInfo.version, installed)) {
      return { ok: false, downloaded: false, message: 'No hay versión nueva disponible para descargar' };
    }
    if (updateDownloaded) return { ok: true, downloaded: true };
    await autoUpdater.downloadUpdate();
    return { ok: true, downloaded: updateDownloaded };
  } catch (error) {
    return { ok: false, message: error?.message || 'No se pudo descargar la actualización' };
  }
});

ipcMain.handle('app:decline-update', async (_event, version) => {
  try {
    userDeclinedSessionVersion = version || null;
    logLine(`[ipc decline-update] version declarada no por esta sesion=${userDeclinedSessionVersion}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error?.message || 'No se pudo guardar la decision' };
  }
});

function resolveRuntimeApiBase() {
  if (isDev) {
    return process.env.SMARTBIS_API_BASE || 'http://localhost:3001';
  }
  const override = process.env.SMARTBIS_API_BASE?.trim();
  if (override) return override;
  return 'https://api.smartbis.ai';
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
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);

  win.on('close', (_event) => {
    try {
      logLine('window-close: enviando app:clear-session al renderer para borrar token');
      win.webContents.send('app:clear-session');
    } catch (_) {}
  });

  win.webContents.on('did-fail-load', (_event, code, desc) => {
    logLine(`did-fail-load code=${code} desc=${desc}`);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    logLine(`render-process-gone reason=${details?.reason || 'unknown'} exitCode=${details?.exitCode || 'unknown'}`);
  });

  win.webContents.on('unresponsive', () => {
    logLine('webContents unresponsive');
  });

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    logLine(`console level=${level} line=${line} source=${sourceId} message=${message}`);
  });

  if (isDev) {
    win.loadURL(startUrl);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.webContents.on('did-finish-load', () => {
    const runtimeApiBase = resolveRuntimeApiBase();
    const installedVersion = app.getVersion();
    logLine(`did-finish-load loaded index apiBase=${runtimeApiBase} installedVersion=${installedVersion}`);
    win.webContents.send('app:runtime', {
      isDesktop: true,
      apiBase: runtimeApiBase,
      isDev,
      installedVersion,
    });
  });

  return win;
}

app.whenReady().then(() => {
  logPath && logLine(`electron-ready appRoot=${app.getAppPath()} path=${process.execPath}`);
  logRuntimeMetadata();
  logLine(`desktop-mode apiBase=${resolveRuntimeApiBase()} (server bundled disabled — using remote backend)`);

  createWindow();

  setTimeout(() => {
    runtimeWindowReady = true;
    if (latestUpdateInfo) {
      notifyUpdateAvailable();
    } else {
      checkForUpdatesIfReady();
    }
  }, 2000);

  setInterval(() => {
    if (latestUpdateInfo && !updateDownloaded) notifyUpdateAvailable();
  }, 15000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
 logLine('window-all-closed');
 if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
 logLine('before-quit');
 try {
   fs.writeFileSync(logPath, logLines.join(''), 'utf8');
 } catch (error) {
   console.error('[smartbis-log] flush failed', error);
 }
});

app.on('will-quit', () => {
 logLine('will-quit');
 try {
   fs.writeFileSync(logPath, logLines.join(''), 'utf8');
 } catch (error) {
   console.error('[smartbis-log] flush failed', error);
 }
});

app.on('certificate-error', (event, _webContents, url, error, certificate, callback) => {
  const acceptHosts = [
    'https://127.0.0.1',
    'http://localhost',
    'https://api.smartbis.ai',
    'https://62.169.16.115',
    'https://www.smartbis.ai',
  ];
  if (acceptHosts.some((h) => url.startsWith(h))) {
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
});
