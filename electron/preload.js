import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('smartbisDesktop', {
  onUpdateAvailable: (handler) => ipcRenderer.on('app:update-available', (_, data) => handler(data)),
  onUpdateDownloaded: (handler) => ipcRenderer.on('app:update-downloaded', () => handler()),
  onUpdateProgress: (handler) => ipcRenderer.on('app:update-progress', (_, data) => handler(data)),
  onUpdateError: (handler) => ipcRenderer.on('app:update-error', (_, data) => handler(data)),
  onRuntime: (handler) => ipcRenderer.on('app:runtime', (_, data) => handler(data)),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  restartAndInstall: () => ipcRenderer.invoke('app:restart-and-update'),
});

window.addEventListener('DOMContentLoaded', () => {
  const link = document.createElement('meta');
  link.setAttribute('name', 'viewport');
  link.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
  document.head.appendChild(link);
});
