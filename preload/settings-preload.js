const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('octotraySettings', {
  load: () => ipcRenderer.invoke('octotray:settings-load'),
  save: (payload) => ipcRenderer.invoke('octotray:settings-save', payload),
  close: () => ipcRenderer.send('octotray:settings-close'),
});
