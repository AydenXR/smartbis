import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('smartbisDesktop', {
  onUpdateAvailable: (handler) => ipcRenderer.on('app:update-available', (_, data) => handler(data)),
  onUpdateDownloaded: (handler) => ipcRenderer.on('app:update-downloaded', () => handler()),
  onUpdateProgress: (handler) => ipcRenderer.on('app:update-progress', (_, data) => handler(data)),
  onUpdateError: (handler) => ipcRenderer.on('app:update-error', (_, data) => handler(data)),
  onUpdateNotAvailable: (handler) => ipcRenderer.on('app:update-not-available', () => handler()),
  onRuntime: (handler) => ipcRenderer.on('app:runtime', (_, data) => handler(data)),
  onClearSession: (handler) => ipcRenderer.on('app:clear-session', () => handler()),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  restartAndInstall: () => ipcRenderer.invoke('app:restart-and-update'),
  declineUpdate: (version) => ipcRenderer.invoke('app:decline-update', version),
  log: (message) => ipcRenderer.send('app:log', message),
});

window.addEventListener('DOMContentLoaded', () => {
  const link = document.createElement('meta');
  link.setAttribute('name', 'viewport');
  link.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
  document.head.appendChild(link);
});
