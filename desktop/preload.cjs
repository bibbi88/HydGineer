// The bridge between the app's page and the computer's files (see src/app/desktopBridge.ts):
// the system's Open and Save dialogs, writing back to a file, and project files handed to the
// app from outside. Nothing else of Node or Electron reaches the page.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

let handler = null;
const waiting = [];
ipcRenderer.on('open-file', (_event, file) => {
  if (handler) handler(file);
  else waiting.push(file);
});

// The window is closing: the page says which circuits have unsaved changes ('list'), or saves
// them ('save') - see desktop/main.cjs.
let closeHandler = null;
ipcRenderer.on('close-request', async (_event, step) => {
  let answer;
  try {
    answer = closeHandler ? await closeHandler(step) : null;
  } catch {
    answer = null;
  }
  ipcRenderer.send('close-response', answer);
});

contextBridge.exposeInMainWorld('hydgineerDesktop', {
  openFile: () => ipcRenderer.invoke('open-file'),
  openPath: (path) => ipcRenderer.invoke('open-path', path),
  // A file dropped on the window: its path on disk, to open it from there.
  pathForFile: (file) => webUtils.getPathForFile(file),
  saveFile: (path, text) => ipcRenderer.invoke('save-file', path, text),
  saveFileAs: (suggestedName, text) => ipcRenderer.invoke('save-file-as', suggestedName, text),
  onCloseRequest: (cb) => {
    closeHandler = cb;
  },
  onOpenFile: (cb) => {
    handler = cb;
    for (const file of waiting.splice(0)) cb(file);
    ipcRenderer.send('renderer-ready');
  },
});
