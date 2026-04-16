const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('octotray', {
  getStatus: () => ipcRenderer.invoke('octotray:get-status'),
  setPopoverHeight: (heightPx) => ipcRenderer.send('octotray:popover-height', heightPx),
  getTrayLogoUrls: () => ipcRenderer.invoke('octotray:tray-logo-urls'),
  onStatusUpdate: (fn) => {
    const listener = (_, payload) => fn(payload);
    ipcRenderer.on('octotray:status-update', listener);
    return () => ipcRenderer.removeListener('octotray:status-update', listener);
  },
});
