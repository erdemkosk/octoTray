const { app, Tray, Menu, nativeImage, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const DEFAULT_BASE_URL = 'http://127.0.0.1:5000';
const DEFAULT_POLL_MS = 5000;
const MIN_POLL_MS = 2000;
const MAX_POLL_MS = 300000;

/**
 * Tray icons (project root):
 * - tray.png — 22×22 px @1x (required), square PNG
 * - tray@2x.png — 44×44 px @2x (optional, Retina)
 * Larger images are resized to these sizes; non-square images are stretched to square.
 */

let tray = null;
let pollTimer = null;
let activePollMs = null;
let popoverWin = null;
let settingsWin = null;
/** Updated each poll; shown only on right-click (never attach via setContextMenu — avoids menu + panel on one click). */
let trayContextMenu = null;

/** @type {object | null} */
let latestSnapshot = null;

function readJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {
    // ignore
  }
  return {};
}

function loadConfig() {
  const envUrl = process.env.OCTOPRINT_URL?.trim();
  const envKey = process.env.OCTOPRINT_API_KEY?.trim();
  const envPoll = process.env.OCTOPRINT_POLL_MS?.trim();
  const localPath = path.join(__dirname, 'config.json');
  const userDataPath = path.join(app.getPath('userData'), 'config.json');
  const file = { ...readJsonFile(localPath), ...readJsonFile(userDataPath) };

  const rawPoll = envPoll ?? file.pollIntervalMs ?? DEFAULT_POLL_MS;
  const n = Number(rawPoll);
  const pollIntervalMs = Math.min(
    MAX_POLL_MS,
    Math.max(MIN_POLL_MS, Number.isFinite(n) && n > 0 ? n : DEFAULT_POLL_MS)
  );

  return {
    baseUrl: (envUrl || file.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, ''),
    apiKey: envKey || file.apiKey || '',
    cfgPath: userDataPath,
    localCfgPath: localPath,
    pollIntervalMs,
    openAtLogin: file.openAtLogin === true,
    envLocked: {
      url: !!envUrl,
      key: !!envKey,
      poll: !!envPoll,
    },
  };
}

const LOGIN_ITEM_DENIED_HINT =
  'macOS blocked “open at login” (Operation not permitted). This is common when running from Terminal, Cursor, or npm start. Use the installed OctoTray.app from /Applications (or the .dmg release), then enable the checkbox again. You can also add OctoTray manually under System Settings → General → Login Items & Extensions.';

function applyOpenAtLogin(enabled) {
  const want = !!enabled;
  try {
    const cur = app.getLoginItemSettings();
    if (cur.openAtLogin === want) return;
  } catch {
    // continue and try to apply
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: want,
      openAsHidden: true,
    });
  } catch (e) {
    console.warn('[OctoTray] Login item:', e?.message || e);
  }
}

function syncOpenAtLoginFromConfig() {
  const want = loadConfig().openAtLogin;
  let cur;
  try {
    cur = app.getLoginItemSettings().openAtLogin;
  } catch {
    cur = false;
  }
  if (cur === want) return;
  applyOpenAtLogin(want);
}

async function octoFetch(url, apiKey) {
  const headers = { Accept: 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text.slice(0, 120)}` : ''}`);
  }
  return res.json();
}

function buildSnapshot(cfg, printer, job, err) {
  return {
    baseUrl: cfg.baseUrl,
    pollIntervalMs: cfg.pollIntervalMs,
    fetchedAt: new Date().toISOString(),
    error: err ? err.message || String(err) : null,
    printer,
    job,
  };
}

function pushSnapshotToPopover() {
  if (!popoverWin || popoverWin.isDestroyed() || !latestSnapshot) return;
  popoverWin.webContents.send('octotray:status-update', latestSnapshot);
}

function syncPollingInterval() {
  const { pollIntervalMs } = loadConfig();
  if (activePollMs === pollIntervalMs && pollTimer) return;
  activePollMs = pollIntervalMs;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshTray, pollIntervalMs);
}

/** Resize/crop-to-square for Electron tray (see TRAY comment above). */
function normalizeTrayIcon(img, sidePx) {
  if (!img || img.isEmpty()) return null;
  const { width, height } = img.getSize();
  if (!width || !height) return null;
  const max = Math.max(width, height);
  if (width === height && max === sidePx) return img;
  return img.resize({ width: sidePx, height: sidePx, quality: 'best' });
}

function loadTrayImage() {
  const p1 = path.join(__dirname, 'tray.png');
  const p2 = path.join(__dirname, 'tray@2x.png');

  if (!fs.existsSync(p1)) {
    throw new Error(
      'Missing tray.png. Add a square PNG: 22×22 (@1x), optional tray@2x.png 44×44 (@2x).'
    );
  }

  let primary = nativeImage.createFromPath(p1);
  primary = normalizeTrayIcon(primary, 22);
  if (!primary || primary.isEmpty()) {
    throw new Error(
      'tray.png is invalid or empty. Use PNG, ideally 22×22 square (optional tray@2x.png 44×44).'
    );
  }

  if (fs.existsSync(p2)) {
    let hi = nativeImage.createFromPath(p2);
    hi = normalizeTrayIcon(hi, 44);
    if (hi && !hi.isEmpty()) {
      try {
        primary.addRepresentation({ scaleFactor: 2, buffer: hi.toPNG() });
      } catch (e) {
        console.warn('[OctoTray] tray@2x.png skipped:', e?.message || e);
      }
    }
  }

  return primary;
}

/** Path for BrowserWindow `icon` (Windows/Linux taskbar; macOS bundle icon comes from electron-builder). */
function resolveAppWindowIcon() {
  const dev = path.join(__dirname, 'build', 'icon.png');
  const packed = path.join(process.resourcesPath, 'app-icon.png');
  const p = app.isPackaged ? packed : dev;
  if (fs.existsSync(p)) return p;
  const fallback = path.join(__dirname, 'tray.png');
  if (fs.existsSync(fallback)) return fallback;
  return undefined;
}

function positionNearTray(win) {
  if (!tray) return;
  const b = tray.getBounds();
  const [bw, bh] = win.getSize();
  let x = Math.round(b.x + b.width / 2 - bw / 2);
  let y;
  if (process.platform === 'darwin') {
    y = Math.round(b.y + b.height + 4);
  } else {
    y = Math.round(b.y - bh - 6);
  }
  const { workArea } = screen.getDisplayNearestPoint({ x: b.x, y: b.y });
  const pad = 10;
  x = Math.max(workArea.x + pad, Math.min(x, workArea.x + workArea.width - bw - pad));
  y = Math.max(workArea.y + pad, Math.min(y, workArea.y + workArea.height - bh - pad));
  win.setPosition(x, y);
}

function closePopover() {
  if (popoverWin && !popoverWin.isDestroyed()) {
    popoverWin.close();
  }
  popoverWin = null;
}

function togglePopover() {
  if (popoverWin && !popoverWin.isDestroyed()) {
    closePopover();
    return;
  }

  const popPreload = path.join(__dirname, 'preload', 'popover-preload.js');
  const popOpts = {
    width: 352,
    height: 280,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    roundedCorners: true,
    webPreferences: {
      preload: popPreload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  if (process.platform === 'darwin') {
    popOpts.vibrancy = 'under-window';
    popOpts.visualEffectState = 'active';
  }
  const winIcon = resolveAppWindowIcon();
  if (winIcon) popOpts.icon = winIcon;
  popoverWin = new BrowserWindow(popOpts);

  popoverWin.loadFile(path.join(__dirname, 'renderer', 'popover.html'));
  popoverWin.once('ready-to-show', () => {
    positionNearTray(popoverWin);
    popoverWin.show();
    pushSnapshotToPopover();
  });

  popoverWin.on('closed', () => {
    popoverWin = null;
  });

  popoverWin.on('blur', () => {
    closePopover();
  });
}

function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }

  const pre = path.join(__dirname, 'preload', 'settings-preload.js');
  const settingsOpts = {
    width: 472,
    height: 468,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    title: 'OctoTray — Settings',
    webPreferences: {
      preload: pre,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  const settingsIcon = resolveAppWindowIcon();
  if (settingsIcon) settingsOpts.icon = settingsIcon;
  settingsWin = new BrowserWindow(settingsOpts);

  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

async function refreshTray() {
  const cfg = loadConfig();
  const { baseUrl, apiKey, cfgPath, localCfgPath, pollIntervalMs } = cfg;
  let printer = null;
  let job = null;
  let err = null;

  try {
    [printer, job] = await Promise.all([
      octoFetch(`${baseUrl}/api/printer`, apiKey),
      octoFetch(`${baseUrl}/api/job`, apiKey),
    ]);
  } catch (e) {
    err = e;
  }

  latestSnapshot = buildSnapshot(cfg, printer, job, err);

  const secPoll = pollIntervalMs / 1000;
  const pollLabel = Number.isInteger(secPoll) ? `every ${secPoll}s` : `every ${secPoll.toFixed(1)}s`;
  const hostShort = baseUrl.replace(/^https?:\/\//, '');
  const tooltip = [
    `OctoTray · ${pollLabel} · ${hostShort}`,
    'Left-click or menu: status panel · Right-click: menu',
    err && !apiKey ? 'Tip: set API key in Configure…' : '',
  ]
    .filter(Boolean)
    .join('\n');

  if (tray) tray.setToolTip(tooltip);

  const ctxMenu = Menu.buildFromTemplate([
    {
      label: 'Open status panel',
      click: () => togglePopover(),
    },
    { type: 'separator' },
    {
      label: 'Configure…',
      click: () => openSettingsWindow(),
    },
    {
      label: 'Paths',
      submenu: [
        { label: `Project\n${localCfgPath}`, enabled: false },
        { label: `User (saved)\n${cfgPath}`, enabled: false },
      ],
    },
    { type: 'separator' },
    {
      label: 'Quit',
      accelerator: 'CommandOrControl+Q',
      registerAccelerator: false,
      click: () => app.quit(),
    },
  ]);

  trayContextMenu = ctxMenu;

  if (process.platform === 'win32' && tray) {
    tray.setTitle('OctoTray');
  }

  syncPollingInterval();
  pushSnapshotToPopover();
}

function registerIpc() {
  ipcMain.handle('octotray:tray-logo-urls', () => {
    const p1 = path.join(__dirname, 'tray.png');
    const p2 = path.join(__dirname, 'tray@2x.png');
    if (!fs.existsSync(p1)) {
      return { src: '', srcset: '' };
    }
    const src = pathToFileURL(p1).href;
    const srcset = fs.existsSync(p2) ? `${src} 1x, ${pathToFileURL(p2).href} 2x` : '';
    return { src, srcset };
  });

  ipcMain.handle('octotray:get-status', () => {
    if (latestSnapshot) return latestSnapshot;
    const c = loadConfig();
    return buildSnapshot(c, null, null, null);
  });

  ipcMain.handle('octotray:settings-load', () => {
    const c = loadConfig();
    let openAtLogin = c.openAtLogin;
    try {
      const li = app.getLoginItemSettings();
      if (li && typeof li.openAtLogin === 'boolean') {
        openAtLogin = li.openAtLogin;
      }
    } catch {
      // ignore
    }
    return {
      baseUrl: c.baseUrl,
      apiKey: c.apiKey,
      pollIntervalMs: c.pollIntervalMs,
      openAtLogin,
      envLocked: c.envLocked,
      savePath: c.cfgPath,
    };
  });

  ipcMain.handle('octotray:settings-save', async (_evt, payload) => {
    const c = loadConfig();
    if (c.envLocked.url || c.envLocked.key || c.envLocked.poll) {
      return {
        ok: false,
        error: 'Cannot save while OCTOPRINT_* environment variables override settings.',
      };
    }

    let baseUrl = String(payload?.baseUrl || '').trim().replace(/\/$/, '');
    if (!baseUrl) {
      return { ok: false, error: 'URL is required.' };
    }
    if (!/^https?:\/\//i.test(baseUrl)) {
      baseUrl = `http://${baseUrl}`;
    }
    try {
      const u = new URL(baseUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return { ok: false, error: 'URL must start with http:// or https://' };
      }
      baseUrl = `${u.protocol}//${u.host}${u.pathname}`.replace(/\/$/, '');
    } catch {
      return { ok: false, error: 'Invalid URL.' };
    }

    const sec = Number(payload?.pollIntervalSec);
    const pollIntervalMs = Math.min(
      MAX_POLL_MS,
      Math.max(MIN_POLL_MS, Number.isFinite(sec) && sec > 0 ? sec * 1000 : DEFAULT_POLL_MS)
    );

    const openAtLogin = payload?.openAtLogin === true;

    const next = {
      ...readJsonFile(c.cfgPath),
      baseUrl,
      apiKey: String(payload?.apiKey || '').trim(),
      pollIntervalMs,
      openAtLogin,
    };

    try {
      fs.mkdirSync(path.dirname(c.cfgPath), { recursive: true });
      fs.writeFileSync(c.cfgPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    } catch (e) {
      return { ok: false, error: e.message || 'Write failed.' };
    }

    applyOpenAtLogin(openAtLogin);

    await new Promise((r) => setTimeout(r, 300));
    let warning = null;
    try {
      const st = app.getLoginItemSettings();
      if (openAtLogin && !st.openAtLogin) {
        warning = LOGIN_ITEM_DENIED_HINT;
      } else if (!openAtLogin && st.openAtLogin) {
        warning =
          'Preference saved as off. If OctoTray still starts at login, remove it under System Settings → General → Login Items & Extensions.';
      }
    } catch {
      if (openAtLogin) warning = LOGIN_ITEM_DENIED_HINT;
    }

    refreshTray();
    return { ok: true, warning };
  });

  ipcMain.on('octotray:settings-close', () => {
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.close();
    }
  });

  ipcMain.on('octotray:popover-height', (_evt, heightPx) => {
    if (!popoverWin || popoverWin.isDestroyed()) return;
    const h = Number(heightPx);
    if (!Number.isFinite(h) || h < 80) return;
    const [w] = popoverWin.getSize();
    const nextH = Math.min(920, Math.max(180, Math.ceil(h)));
    popoverWin.setSize(w, nextH);
    positionNearTray(popoverWin);
  });
}

app.whenReady().then(async () => {
  registerIpc();
  syncOpenAtLoginFromConfig();

  if (process.platform === 'darwin') app.dock?.hide();

  tray = new Tray(loadTrayImage());
  tray.setToolTip('OctoTray · loading…');

  tray.on('click', () => {
    togglePopover();
  });

  tray.on('right-click', () => {
    if (trayContextMenu) {
      tray.popUpContextMenu(trayContextMenu);
    }
  });

  await refreshTray();
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  if (pollTimer) clearInterval(pollTimer);
});
