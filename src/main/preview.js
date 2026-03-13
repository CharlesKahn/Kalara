'use strict';
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ─── Paths ─────────────────────────────────────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, '../../docs/config.json');
const RENDERER    = path.join(__dirname, '../renderer');
const PRELOAD     = path.join(__dirname, 'preload.js');

function loadConfig() {
  try { if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch (e) {}
  return { theme: 'dark' };
}

// ─── State ─────────────────────────────────────────────────────────────────────
let controlPanel    = null;
let previewWindow   = null;
let reloadTimer     = null;
let currentTarget   = null;
let injectionTimers = [];

// ─── Dummy data ────────────────────────────────────────────────────────────────
const DUMMY = {
  topbar: {
    answer: 'Three revenue streams:\nEnterprise SaaS at $50K ARR per year\nChannel partnerships drive 30% of new pipeline\nUsage-based API tier for developer teams',
    expandedAnswer: [
      'The enterprise tier is our core motion — average deal size is $50K ARR with 18-month contracts.',
      'Channel partners like Salesforce and HubSpot resellers contribute roughly 30% of new pipeline at lower CAC.',
      'The API tier targets developer-led teams and scales with usage — no seat licensing overhead.',
      "We're seeing 3x expansion revenue from existing enterprise accounts by year two.",
      'Net revenue retention sits at 118%, driven almost entirely by organic expansion.',
    ].join('\n'),
    confidence: 'high',
    sources: ['pitch-deck.pdf', 'financials.xlsx'],
    chunkIds: ['chunk-001', 'chunk-002'],
    awarenessMode: false,
    fromWeb: false,
  },
  sidebar: {
    answer: "Market size is $4.2B TAM, growing 34% YoY.\nWe're targeting the $800M enterprise segment first.\nBottom-up expansion into SMB is planned for year three.",
    expandedAnswer: null,
    confidence: 'high',
    sources: ['market-analysis.pdf'],
    chunkIds: ['chunk-010'],
    awarenessMode: true,
    fromWeb: false,
    speaker: 'Sarah Chen',
    question: "What's your total addressable market?",
  },
  eyeline: {
    answer: 'Three revenue streams:\nEnterprise SaaS at $50K ARR per year\nChannel partnerships drive 30% of new pipeline\nUsage-based API tier for developer teams',
    confidence: 'high',
    chunkIds: ['chunk-020'],
    fromWeb: false,
  },
  'bot-left-toast': {
    title: 'Series A Prep — Sequoia Capital',
    callId: 'preview-call-001',
    projectId: 'proj_preview',
    botOnly: false,
  },
  'meeting-alert': {
    id: 'preview-event-001',
    title: 'Investor Demo — Benchmark Capital',
    meetLink: 'https://meet.google.com/abc-defg-hij',
    organizer: { name: 'James Park', email: 'james@benchmark.com' },
  },
};

// ─── IPC stubs required by renderer windows ────────────────────────────────────
ipcMain.handle('get-config',            () => loadConfig());
ipcMain.handle('get-google-auth-status',() => ({ signedIn: false }));
ipcMain.handle('get-google-profile',    () => null);
ipcMain.handle('refresh-google-profile',() => null);
ipcMain.handle('get-tray-state',        () => ({ mode: 'passive', coaching: false, sessionActive: false, sessions: [] }));
ipcMain.handle('get-cached-meetings',   () => []);
ipcMain.handle('get-upcoming-meetings', () => []);
ipcMain.handle('get-fresh-meetings',    () => []);
ipcMain.handle('get-preview-file-path', () => null);

ipcMain.on('hide-topbar', () => previewWindow?.hide());

ipcMain.on('resize-topbar', (_, height) => {
  if (!previewWindow || previewWindow.isDestroyed()) return;
  const w = previewWindow.getBounds().width;
  previewWindow.setSize(w, height);
});

ipcMain.on('resize-topbar-width', (_, width) => {
  if (!previewWindow || previewWindow.isDestroyed()) return;
  const { width: maxW } = screen.getPrimaryDisplay().workAreaSize;
  const w = Math.round(Math.min(maxW, Math.max(400, width)));
  const h = previewWindow.getBounds().height;
  previewWindow.setSize(w, h);
});

ipcMain.on('topbar-set-position', (_, x, y) => {
  if (!previewWindow || previewWindow.isDestroyed()) return;
  const b = previewWindow.getBounds();
  previewWindow.setBounds({ ...b, x: Math.round(x), y: Math.round(y) });
});

ipcMain.on('eyeline-mouse', (_, ignore) => {
  previewWindow?.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('eyeline-resize', (_, size) => {
  if (!previewWindow || previewWindow.isDestroyed()) return;
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  const w = size === 'large' ? 720 : 450;
  const h = size === 'large' ? 111 : 88;
  previewWindow.setBounds({ x: Math.round((sw - w) / 2), y: 8, width: w, height: h });
});

ipcMain.on('meeting-alert-action', () => {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.removeAllListeners('closed');
    previewWindow.close();
  }
  previewWindow = null;
});

ipcMain.on('bot-left-toast-dismiss', () => {
  const win = previewWindow;
  if (win && !win.isDestroyed() && currentTarget === 'bot-left-toast') {
    const duration = 250;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const opacity = Math.max(0, 1 - elapsed / duration);
      if (win.isDestroyed()) return;
      win.setOpacity(opacity);
      if (opacity > 0) setTimeout(tick, 16);
      else win.close();
    };
    tick();
  }
});

ipcMain.on('window-control', (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  if (action === 'close')    win.close();
  if (action === 'minimize') win.minimize();
});

ipcMain.on('sidebar-resize', (_, { collapsed }) => {
  if (!previewWindow || previewWindow.isDestroyed()) return;
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const fullW = Math.round(sw * 0.32);
  if (collapsed) {
    previewWindow.setBounds({ x: sw - 55, y: 24, width: 55, height: 80 });
  } else {
    previewWindow.setBounds({ x: sw - fullW, y: 0, width: fullW, height: sh });
  }
});

ipcMain.on('resize-tray-menu', (_, h) => {
  if (!previewWindow || previewWindow.isDestroyed()) return;
  const { x, y, width } = previewWindow.getBounds();
  previewWindow.setBounds({ x, y, width, height: h });
});

[
  'save-theme', 'save-hotkey', 'save-web-search-config', 'save-coaching-config',
  'save-engagement-config', 'save-eyeline-behavior', 'save-dismiss-timer',
  'save-dismiss-hotkey', 'save-display-config', 'save-bot-name', 'save-autojoin-config',
  'save-rag-model', 'open-settings', 'settings-minimize', 'settings-fullscreen',
  'google-connect', 'google-start-auth', 'google-disconnect', 'close-oauth-window',
  'tray-open-projects', 'tray-open-doc-manager', 'tray-open-recall-setup',
  'tray-toggle-coaching', 'tray-set-mode', 'tray-open-settings', 'tray-quit',
  'close-tray-menu', 'keep-session-active', 'autojoin-cancel', 'tray-end-session',
  'open-call-summary', 'spotlight-submit', 'spotlight-close', 'open-in-default-app',
  'tray-prefill-meeting-url', 'open-doc-preview',
  'meeting-alert-dropdown-open', 'meeting-alert-dropdown-close',
  'project-dropdown-select',
].forEach(ch => ipcMain.on(ch, () => {}));

// ─── Open preview window ───────────────────────────────────────────────────────
function openPreview(key) {
  injectionTimers.forEach(t => clearTimeout(t));
  injectionTimers = [];
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.removeAllListeners('closed');
    previewWindow.close();
    previewWindow = null;
  }
  currentTarget = key;

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  const defs = {
    topbar:          { width: sw,                    height: 170,       x: 0,                          y: 0,            frame: false, transparent: true,  hasShadow: false, file: 'topbar.html' },
    sidebar:         { width: Math.round(sw * 0.32), height: sh,        x: sw - Math.round(sw * 0.32), y: 0,            frame: false, transparent: true,  hasShadow: false, file: 'sidebar.html' },
    eyeline:         { width: 450,                   height: 88,        x: Math.round((sw - 450) / 2), y: 8,            frame: false, transparent: true,  hasShadow: false, file: 'eyeline.html' },
    'bot-left-toast':{ width: 300,                   height: 100,       x: sw - 316,                   y: sh - 116,     frame: false, transparent: true,  hasShadow: true,  file: 'bot-left-toast.html' },
    'meeting-alert': { width: 345,                   height: 135,       x: sw - 340,                   y: sh - 220,     frame: false, transparent: true,  hasShadow: false, file: 'meeting-alert.html' },
    settings:        { width: 520,                   height: 580,       x: Math.round((sw - 520) / 2), y: Math.round((sh - 580) / 2), frame: false, transparent: true, hasShadow: false, file: 'settings.html' },
  };

  const def = defs[key];
  if (!def) return;

  previewWindow = new BrowserWindow({
    width: def.width, height: def.height, x: def.x, y: def.y,
    frame: def.frame, transparent: def.transparent,
    alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: def.hasShadow,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: PRELOAD },
  });

  previewWindow.loadFile(path.join(RENDERER, def.file));
  previewWindow.on('closed', () => {
    previewWindow = null;
    currentTarget = null;
    controlPanel?.webContents.send('preview-status', 'No window open');
  });
  previewWindow.webContents.once('did-finish-load', () => {
    injectDummyData(key);
    controlPanel?.webContents.send('preview-status', `Showing: ${key}`);
  });
}

function injectDummyData(key) {
  if (!previewWindow || previewWindow.isDestroyed()) return;
  const wc = previewWindow.webContents;

  if (key === 'topbar') {
    wc.send('new-answer', DUMMY.topbar);
    previewWindow.show();

  } else if (key === 'sidebar') {
    wc.send('awareness-mode', true);
    wc.send('new-answer', DUMMY.sidebar);
    injectionTimers.push(setTimeout(() => {
      if (!previewWindow || previewWindow.isDestroyed()) return;
      wc.send('transcript-update', { speaker: 'James Park', text: "What's your total addressable market?" });
    }, 400));
    previewWindow.show();

  } else if (key === 'eyeline') {
    wc.send('eyeline-behavior', 'passive');
    wc.send('eyeline-answer', DUMMY.eyeline);
    previewWindow.show();

  } else if (key === 'bot-left-toast') {
    wc.send('bot-left-toast', DUMMY['bot-left-toast']);
    previewWindow.show();

  } else if (key === 'meeting-alert') {
    const start = new Date(Date.now() + 8 * 60 * 1000);
    wc.send('meeting-alert-data', {
      ...DUMMY['meeting-alert'],
      startIso: start.toISOString(),
      endIso:   new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    });
    previewWindow.show();

  } else if (key === 'settings') {
    previewWindow.show();
  }
}

// ─── File watcher ──────────────────────────────────────────────────────────────
function startWatcher() {
  fs.watch(RENDERER, { persistent: false }, (_, filename) => {
    if (!filename?.endsWith('.html')) return;
    if (!previewWindow || previewWindow.isDestroyed()) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (!previewWindow || previewWindow.isDestroyed()) return;
      previewWindow.webContents.reloadIgnoringCache();
      previewWindow.webContents.once('did-finish-load', () => {
        if (currentTarget) injectDummyData(currentTarget);
      });
    }, 200);
  });
}

// ─── IPC from control panel ────────────────────────────────────────────────────
ipcMain.on('preview-show', (_, key) => openPreview(key));

// ─── Control panel HTML ────────────────────────────────────────────────────────
const PANEL_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
    background: #1e1e2e;
    color: #cdd6f4;
    padding: 20px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 14px;
    -webkit-app-region: drag;
    user-select: none;
    overflow: hidden;
  }
  h1 {
    font-size: 11.5px;
    font-weight: 600;
    color: #89b4fa;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .divider { height: 1px; background: #313244; flex-shrink: 0; }
  label { font-size: 10.5px; color: #a6adc8; text-transform: uppercase; letter-spacing: 0.07em; display: block; margin-bottom: 6px; }
  select {
    width: 100%;
    padding: 8px 10px;
    background: #313244;
    border: 1px solid #45475a;
    border-radius: 6px;
    color: #cdd6f4;
    font-size: 13px;
    outline: none;
    cursor: pointer;
    -webkit-app-region: no-drag;
  }
  select:focus { border-color: #89b4fa; }
  button {
    width: 100%;
    padding: 10px;
    background: #89b4fa;
    border: none;
    border-radius: 6px;
    color: #1e1e2e;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    -webkit-app-region: no-drag;
    transition: background 0.12s;
  }
  button:hover { background: #b4d0ff; }
  .status {
    font-size: 11px;
    color: #585b70;
    font-style: italic;
    text-align: center;
    padding: 4px 0;
  }
  .status.active { color: #a6e3a1; font-style: normal; }
  .hint {
    font-size: 10.5px;
    color: #45475a;
    line-height: 1.7;
    margin-top: auto;
  }
  .hint em { color: #6c7086; font-style: normal; }
</style>
</head>
<body>
  <h1>Preview Dev Tool</h1>
  <div class="divider"></div>
  <div>
    <label>Window</label>
    <select id="sel">
      <option value="topbar">Topbar</option>
      <option value="sidebar">Sidebar</option>
      <option value="eyeline">Eyeline</option>
      <option value="bot-left-toast">Bot-left toast</option>
      <option value="meeting-alert">Meeting alert</option>
      <option value="settings">Settings</option>
    </select>
  </div>
  <button id="showBtn">Show</button>
  <p class="status" id="status">No window open</p>
  <div class="divider"></div>
  <p class="hint">
    File watcher active on<br>
    <em>src/renderer/*.html</em> — edits reload automatically.
  </p>
<script>
  const { ipcRenderer } = require('electron');
  document.getElementById('showBtn').addEventListener('click', () => {
    ipcRenderer.send('preview-show', document.getElementById('sel').value);
  });
  ipcRenderer.on('preview-status', (_, msg) => {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className = 'status' + (msg !== 'No window open' ? ' active' : '');
  });
</script>
</body>
</html>`;

// ─── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const tmpHtml = path.join(os.tmpdir(), 'brio-preview-panel.html');
  fs.writeFileSync(tmpHtml, PANEL_HTML);

  controlPanel = new BrowserWindow({
    width: 300, height: 380,
    title: 'Preview',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    hasShadow: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  controlPanel.loadFile(tmpHtml);
  controlPanel.on('closed', () => {
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.removeAllListeners('closed');
      previewWindow.close();
    }
    previewWindow = null;
    app.quit();
  });

  startWatcher();
});

app.on('window-all-closed', () => app.quit());
