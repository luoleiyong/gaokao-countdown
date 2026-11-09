'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gaokao', {
  getInit: () => ipcRenderer.invoke('app:get-init'),
  saveSettings: (patch) => ipcRenderer.invoke('app:save-settings', patch),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('app:set-auto-launch', enabled),
  addHistory: (entry) => ipcRenderer.invoke('app:add-history', entry),
  clearHistory: () => ipcRenderer.invoke('app:clear-history'),
  getLogs: () => ipcRenderer.invoke('app:get-logs'),
  getWeather: () => ipcRenderer.invoke('weather:get'),
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  openExternal: (url) => ipcRenderer.invoke('app:open-url', url),
  saveImage: (dataUrl, name) => ipcRenderer.invoke('app:save-image', dataUrl, name),
  log: (event, detail) => ipcRenderer.send('app:log', event, detail),
  setPetMode: (on) => ipcRenderer.invoke('window:set-pet-mode', on),
  changeScale: (delta) => ipcRenderer.invoke('window:change-scale', delta),
  openKnowledge: () => ipcRenderer.invoke('knowledge:open'),
  closeKnowledge: () => ipcRenderer.send('knowledge:close'),
  petMenu: () => ipcRenderer.send('pet:menu'),
  hideToTray: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('app:quit'),
  onModeChanged: (cb) => ipcRenderer.on('mode:changed', (_e, data) => cb(data)),
  onSkinChanged: (cb) => ipcRenderer.on('skin:changed', (_e, data) => cb(data)),
  onScaleChanged: (cb) => ipcRenderer.on('scale:changed', (_e, data) => cb(data))
});
