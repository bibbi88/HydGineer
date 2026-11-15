// HydGineer as a desktop app: the web app's single built page (copied to app/index.html at
// build time, see .github/workflows/desktop.yml) in its own window. Everything the app does runs
// in the page itself; this opens the window and lends the page the computer's file dialogs
// (preload.cjs): Open, Save back to the same file, Save as, and project files double-clicked or
// given on the command line.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const FILTERS = [
  { name: 'HydGineer project', extensions: ['hgcl'] },
  { name: 'All files', extensions: ['*'] },
];

/** Only project files are read or written for the page. */
const PROJECT_FILE = /\.(hgcl|json)$/i;
/** Files the page may write to: ones the user opened or chose (a dialog, a double-click, the
 * command line, a recent file). Anything else it asks to overwrite is refused. */
const allowedPaths = new Set();

/** Where the file dialogs open: the folder last opened from or saved to. */
let lastDir = null;
/** Project files to open once the page is ready to take them. */
let pending = [];
let rendererReady = false;

/** Project files among command-line arguments (a double-clicked .hgcl arrives this way). */
function projectFilesIn(argv) {
  return argv.slice(1).filter((a) => /\.(hgcl|json)$/i.test(a) && !a.startsWith('-'));
}

async function readProject(file) {
  const full = path.resolve(file);
  if (!PROJECT_FILE.test(full)) throw new Error('Not a HydGineer project file');
  const text = await fs.readFile(full, 'utf8');
  lastDir = path.dirname(full);
  allowedPaths.add(full);
  return { path: full, text };
}

async function sendFiles(files) {
  for (const f of files) {
    try {
      const project = await readProject(f);
      if (win) win.webContents.send('open-file', project);
    } catch (err) {
      dialog.showErrorBox('HydGineer', `Couldn't open ${f}:\n${err.message}`);
    }
  }
}

ipcMain.handle('open-file', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open project',
    defaultPath: lastDir ?? app.getPath('documents'),
    filters: FILTERS,
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return readProject(result.filePaths[0]);
});

// A recent file from the start screen: null if it's gone (moved, deleted, renamed).
ipcMain.handle('open-path', async (_event, file) => {
  try {
    return await readProject(file);
  } catch {
    return null;
  }
});

ipcMain.handle('save-file', async (_event, file, text) => {
  const full = path.resolve(String(file));
  if (!allowedPaths.has(full) || !PROJECT_FILE.test(full) || typeof text !== 'string') return false;
  try {
    await fs.writeFile(file, text, 'utf8');
    lastDir = path.dirname(file);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('save-file-as', async (_event, suggestedName, text) => {
  const result = await dialog.showSaveDialog(win, {
    title: 'Save project',
    defaultPath: path.join(lastDir ?? app.getPath('documents'), suggestedName),
    filters: FILTERS,
  });
  if (result.canceled || !result.filePath) return null;
  let file = result.filePath;
  if (!/\.[^\\/.]+$/.test(path.basename(file))) file += '.hgcl';
  try {
    await fs.writeFile(file, text, 'utf8');
  } catch (err) {
    dialog.showErrorBox('HydGineer', `Couldn't save to ${file}:\n${err.message}`);
    return null;
  }
  lastDir = path.dirname(file);
  allowedPaths.add(path.resolve(file));
  return file;
});

// Updates (Windows installer, Linux AppImage): checked only when the page asks - it does, at start, while
// its "Check for updates" setting is on - so with the setting off the app never goes online.
// electron-updater isn't even loaded until then. A newer version is downloaded in the
// background, and installed when the user chooses Restart now, or else when the app is closed.
let updater = null;

/** The Windows installer, or the Linux AppImage (which replaces its own file) - not the Flatpak,
 * which Flatpak keeps up to date, nor a development run. */
function updatesSupported() {
  if (!app.isPackaged) return false;
  return process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE);
}

function sendUpdateStatus(status) {
  if (win) win.webContents.send('update-status', status);
}

function getUpdater() {
  if (updater) return updater;
  updater = require('electron-updater').autoUpdater;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  // The installer keeps one file name across versions (for fixed download links), which
  // differential downloads can't work with: always the whole installer.
  updater.disableDifferentialDownload = true;
  updater.logger = null;
  updater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));
  updater.on('update-not-available', () => sendUpdateStatus({ state: 'none' }));
  updater.on('update-available', (info) =>
    sendUpdateStatus({ state: 'downloading', version: info.version, percent: 0 }),
  );
  updater.on('download-progress', (p) =>
    sendUpdateStatus({ state: 'downloading', percent: Math.round(p.percent) }),
  );
  updater.on('update-downloaded', (info) =>
    sendUpdateStatus({ state: 'ready', version: info.version }),
  );
  updater.on('error', (err) =>
    sendUpdateStatus({ state: 'error', message: err ? String(err.message || err) : 'unknown' }),
  );
  return updater;
}

ipcMain.handle('updates-supported', () => updatesSupported());
ipcMain.handle('check-updates', async () => {
  if (!updatesSupported()) return;
  try {
    await getUpdater().checkForUpdates();
  } catch (err) {
    sendUpdateStatus({ state: 'error', message: String((err && err.message) || err) });
  }
});
ipcMain.on('install-update', () => {
  // Silently, and the app starts again afterwards. Unsaved circuits are asked about first (the
  // window's close handler); if that's cancelled, the update waits for the next time it closes.
  if (updater) updater.quitAndInstall(true, true);
});

ipcMain.on('renderer-ready', () => {
  rendererReady = true;
  void sendFiles(pending.splice(0));
});

// One window: opening the app again (or a .hgcl file) brings the running one forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
/** Set once the user has settled what happens to unsaved circuits: the window may then close. */
let closeConfirmed = false;

/** Asks the page a closing question (see preload.cjs); null if it doesn't answer in time - a
 * stuck page must never keep the window from closing. */
function askPage(step, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ipcMain.removeListener('close-response', onAnswer);
      resolve(null);
    }, timeoutMs);
    function onAnswer(_event, answer) {
      clearTimeout(timer);
      resolve(answer);
    }
    ipcMain.once('close-response', onAnswer);
    win.webContents.send('close-request', step);
  });
}

/** Closing the window with unsaved circuits: Save / Don't save / Cancel, as desktop programs
 * do. Save saves them first (asking where for new ones) and closes only if all got saved. */
async function confirmClose() {
  const unsaved = await askPage('list', 3000);
  if (!Array.isArray(unsaved) || unsaved.length === 0) return true;
  const names = unsaved.map((n) => `  - ${n}`).join('\n');
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save', "Don't save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: 'HydGineer',
    message:
      unsaved.length === 1
        ? `Save changes to "${unsaved[0]}" before closing?`
        : `Save changes to ${unsaved.length} circuits before closing?`,
    detail: unsaved.length === 1 ? undefined : names,
  });
  if (response === 2) return false;
  if (response === 1) return true;
  // Saving can take as long as the user spends in Save As dialogs.
  return (await askPage('save', 24 * 60 * 60 * 1000)) === true;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'HydGineer',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#f7f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const appFile = path.join(__dirname, 'app', 'index.html');
  win.loadFile(appFile);

  // Links to the web (help, GitHub) open in the normal browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // The window only ever shows the app itself: no navigating away - to a web page (those open
  // in the browser) or to some local file dropped on it.
  const appUrl = pathToFileURL(appFile).href;
  win.webContents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] === appUrl) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  win.on('close', (event) => {
    if (closeConfirmed) return;
    event.preventDefault();
    void confirmClose().then((ok) => {
      if (!ok || !win) return;
      closeConfirmed = true;
      win.close();
    });
  });
  // The page's own "leave this page?" guard is never used in the app; should one fire anyway,
  // it mustn't silently block closing.
  win.webContents.on('will-prevent-unload', (event) => event.preventDefault());
  win.on('closed', () => {
    win = null;
  });
}

// No menu bar: the app has its own toolbar, and the default menu's shortcuts (Ctrl+R reloads,
// for one) would take keys the app uses itself - Ctrl+R is redo.
Menu.setApplicationMenu(null);

// Opened again - a .hgcl double-clicked while it runs: that file opens in the running window.
app.on('second-instance', (_event, argv) => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  const files = projectFilesIn(argv);
  if (rendererReady) void sendFiles(files);
  else pending.push(...files);
});

app.whenReady().then(() => {
  pending = projectFilesIn(process.argv);
  createWindow();
});
app.on('window-all-closed', () => app.quit());
