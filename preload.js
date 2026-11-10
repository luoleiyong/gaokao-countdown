'use strict';
const { contextBridge, ipcRenderer, webUtils, clipboard } = require('electron');

contextBridge.exposeInMainWorld('gaokao', {
  getInit: () => ipcRenderer.invoke('app:get-init'),
  saveSettings: (patch) => ipcRenderer.invoke('app:save-settings', patch),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('app:set-auto-launch', enabled),
  addHistory: (entry) => ipcRenderer.invoke('app:add-history', entry),
  saveEvents: (list) => ipcRenderer.invoke('app:save-events', list),
  exportData: () => ipcRenderer.invoke('app:export-data'),
  importData: () => ipcRenderer.invoke('app:import-data'),
  setFullScreen: (on) => ipcRenderer.invoke('window:set-fullscreen', on),
  getWeather: () => ipcRenderer.invoke('weather:get'),
  getWeatherHourly: () => ipcRenderer.invoke('weather:hourly'),
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  downloadUpdate: (urls) => ipcRenderer.invoke('app:download-update', urls),
  downloadUpdatePackage: (payload) => ipcRenderer.invoke('app:update-download', payload),
  installUpdate: (filePath) => ipcRenderer.invoke('app:install-update', filePath),
  deferInstall: (filePath) => ipcRenderer.invoke('app:defer-install', filePath),
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_e, data) => cb(data)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_e, data) => cb(data)),
  onUpdateError: (cb) => ipcRenderer.on('update:error', (_e, data) => cb(data)),
  openExternal: (url) => ipcRenderer.invoke('app:open-url', url),
  copyText: (text) => {
    try {
      clipboard.writeText(String(text == null ? '' : text));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
  saveImage: (dataUrl, name) => ipcRenderer.invoke('app:save-image', dataUrl, name),
  log: (event, detail) => ipcRenderer.send('app:log', event, detail),
  setPetMode: (on) => ipcRenderer.invoke('window:set-pet-mode', on),
  changeScale: (delta) => ipcRenderer.invoke('window:change-scale', delta),
  openKnowledge: () => ipcRenderer.invoke('knowledge:open'),
  closeKnowledge: () => ipcRenderer.send('knowledge:close'),
  openClassroom: () => ipcRenderer.invoke('classroom:open'),
  openClassroomAdmin: () => ipcRenderer.invoke('classroom:open-admin'),
  closeClassroom: () => ipcRenderer.send('classroom:close'),
  openTimetable: () => ipcRenderer.invoke('timetable:open'),
  closeTimetable: () => ipcRenderer.send('timetable:close'),
  petMenu: () => ipcRenderer.send('pet:menu'),
  hideToTray: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('app:quit'),
  onModeChanged: (cb) => ipcRenderer.on('mode:changed', (_e, data) => cb(data)),
  onSkinChanged: (cb) => ipcRenderer.on('skin:changed', (_e, data) => cb(data)),
  onScaleChanged: (cb) => ipcRenderer.on('scale:changed', (_e, data) => cb(data)),
  onDebugChanged: (cb) => ipcRenderer.on('debug:changed', (_e, data) => cb(data)),
  onDebugPreview: (cb) => ipcRenderer.on('debug:preview', () => cb()),

  /* 课堂助手 */
  getFilePath: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch (e) {
      return '';
    }
  },
  classroomGet: () => ipcRenderer.invoke('classroom:get'),
  classroomAdminStatus: () => ipcRenderer.invoke('classroom:admin-status'),
  classroomAdminData: () => ipcRenderer.invoke('classroom:admin-data'),
  classroomAdminSetup: (password) => ipcRenderer.invoke('classroom:admin-setup', password),
  classroomAdminLogin: (password) => ipcRenderer.invoke('classroom:admin-login', password),
  classroomAdminLock: () => ipcRenderer.invoke('classroom:admin-lock'),
  classroomChangePassword: (oldPassword, newPassword) => ipcRenderer.invoke('classroom:admin-change-password', oldPassword, newPassword),
  classroomImportRosters: (paths) => ipcRenderer.invoke('classroom:import-rosters', paths),
  classroomCreateRoster: (name) => ipcRenderer.invoke('classroom:create-roster', name),
  classroomSetActive: (id) => ipcRenderer.invoke('classroom:set-active', id),
  classroomRenameRoster: (id, name) => ipcRenderer.invoke('classroom:rename-roster', id, name),
  classroomDeleteRoster: (id) => ipcRenderer.invoke('classroom:delete-roster', id),
  classroomAddNames: (rosterId, text) => ipcRenderer.invoke('classroom:add-names', rosterId, text),
  classroomUpdateName: (rosterId, nameId, patch) => ipcRenderer.invoke('classroom:update-name', rosterId, nameId, patch),
  classroomRemoveName: (rosterId, nameId) => ipcRenderer.invoke('classroom:remove-name', rosterId, nameId),
  classroomResetCounts: (rosterId) => ipcRenderer.invoke('classroom:reset-counts', rosterId),
  classroomDraw: (rosterId, count, options) => ipcRenderer.invoke('classroom:draw', rosterId, count, options),
  classroomClearHistory: () => ipcRenderer.invoke('classroom:clear-history'),
  classroomRestoreHistory: () => ipcRenderer.invoke('classroom:restore-history'),
  classroomSaveTimetable: (timetable) => ipcRenderer.invoke('classroom:save-timetable', timetable),
  classroomParseSheet: (filePath) => ipcRenderer.invoke('classroom:parse-sheet', filePath),
  adminSetDebug: (on) => ipcRenderer.invoke('admin:set-debug', on),
  adminTriggerDraw: () => ipcRenderer.invoke('admin:trigger-draw'),
  onAdminOpen: (cb) => ipcRenderer.on('admin:open', () => cb())
});
