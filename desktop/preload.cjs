// The only bridge between the page and the machine. The page can ask the user
// to pick a scans folder and can receive files — nothing else crosses.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deidDesktop', {
  edition: 'mac-1.0',
  chooseInbox: () => ipcRenderer.invoke('choose-inbox'),
  onFile: (cb) => ipcRenderer.on('inbox-file', (_e, f) => cb(f)),
});
