const { app, BrowserWindow, Tray, screen, ipcMain, nativeImage, globalShortcut, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const { startWebhookServer, setWebSearchConfig, setCoachingCfg, setEngagementCfg } = require('../server/webhook');

// ─── Paths ─────────────────────────────────────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, '../../docs/config.json');

// ─── Config ────────────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch (e) {}
  return { hotkey: 'CommandOrControl+Shift+Space' };
}

function saveConfig(data) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

// ─── Module-level state ────────────────────────────────────────────────────────
let topBarWindow      = null;
let sidebarWindow     = null;
let eyelineWindow     = null;
let spotlightWindow   = null;
let postSearchWindow  = null;
let settingsWindow    = null;
let trayMenuWindow    = null;
let tray              = null;

let awarenessMode    = false;
let eyelineMode      = false;
let coachingMode     = false;
let oauthWindow      = null;
let recallSetupWindow = null;
let meetingAlertWindow = null;
let docPreviewWindow   = null;
let docPreviewFilePath = null;
let calendarPollTimer  = null;
let cachedMeetings     = [];
const alertedMeetingIds  = new Set();
const autoJoinedEventIds = new Set();
let autoJoinToastWindow  = null;
let autoEndToastWindow   = null;
let botLeftToastWindow   = null;

// Multi-session state: Map<botId, { meetingUrl, botOnly, projectId }>
const activeSessions = new Map();

// ─── Google OAuth helpers ─────────────────────────────────────────────────────
function buildGoogleAuthUrl() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  console.log('[oauth] buildGoogleAuthUrl — clientId present:', !!clientId);
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  'http://localhost:3847/oauth/callback',
    response_type: 'code',
    scope:         'openid email profile https://www.googleapis.com/auth/calendar.readonly',
    access_type:   'offline',
    prompt:        'consent',
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  console.log('[oauth] Built auth URL — redirect_uri: http://localhost:3847/oauth/callback');
  return url;
}

async function refreshGoogleToken(refreshToken) {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshToken) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: clientId,
      client_secret: clientSecret, grant_type: 'refresh_token',
    }),
  });
  return res.json();
}

// ─── Google Calendar helpers ──────────────────────────────────────────────────
async function getValidAccessToken() {
  const config = loadConfig();
  const auth = config.googleAuth;
  if (!auth) return null;
  if (auth.expiresAt && auth.expiresAt > Date.now() + 60000) return auth.accessToken;
  if (!auth.refreshToken) return null;
  try {
    const tokens = await refreshGoogleToken(auth.refreshToken);
    if (!tokens?.access_token) return null;
    auth.accessToken = tokens.access_token;
    auth.expiresAt   = Date.now() + (tokens.expires_in || 3600) * 1000;
    config.googleAuth = auth;
    saveConfig(config);
    return auth.accessToken;
  } catch (e) {
    return null;
  }
}

async function fetchUpcomingMeetings(windowMinutes = 60) {
  const token = await getValidAccessToken();
  if (!token) return [];
  const now = new Date();
  const max = new Date(now.getTime() + windowMinutes * 60 * 1000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: max.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '10',
  });
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (!Array.isArray(data.items)) {
      console.log('[calendar] fetchUpcomingMeetings — no items array in response:', JSON.stringify(data).slice(0, 200));
      return [];
    }
    console.log(`[calendar] fetchUpcomingMeetings — raw events from Google (${data.items.length}):`);
    data.items.forEach(ev => {
      const meetLink = ev.conferenceData?.entryPoints?.find(
        ep => ep.entryPointType === 'video' && ep.uri?.includes('meet.google.com')
      )?.uri;
      console.log(`[calendar]   "${ev.summary || '(no title)'}" start:${ev.start?.dateTime || ev.start?.date} meetLink:${meetLink ? meetLink : 'NONE'}`);
    });
    const results = data.items.map(ev => {
      const meetLink = ev.conferenceData?.entryPoints?.find(
        ep => ep.entryPointType === 'video' && ep.uri?.includes('meet.google.com')
      )?.uri || null;
      const endIso = ev.end?.dateTime || ev.end?.date || null;
      return {
        id:        ev.id,
        title:     ev.summary || 'Untitled Meeting',
        startIso:  ev.start?.dateTime || ev.start?.date,
        endIso,
        meetLink,
        organizer: ev.organizer
          ? { name: ev.organizer.displayName || '', email: ev.organizer.email || '' }
          : null,
      };
    })
    .filter(m => !m.endIso || new Date(m.endIso).getTime() > Date.now()); // exclude ended meetings
    console.log(`[calendar] fetchUpcomingMeetings — returning ${results.length} events (excluding ended meetings)`);
    return results;
  } catch (e) {
    console.error('[calendar] fetch error:', e.message);
    return [];
  }
}

function openMeetingAlert(meeting) {
  if (meetingAlertWindow && !meetingAlertWindow.isDestroyed()) {
    meetingAlertWindow.webContents.send('meeting-alert-data', meeting);
    meetingAlertWindow.focus();
    return;
  }
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  meetingAlertWindow = new BrowserWindow({
    width: 345,
    height: 135,
    x: sw - 340,
    y: sh - 220,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  meetingAlertWindow.loadFile(path.join(__dirname, '../renderer/meeting-alert.html'));
  meetingAlertWindow.on('closed', () => { meetingAlertWindow = null; });
  meetingAlertWindow.webContents.once('did-finish-load', () => {
    meetingAlertWindow?.webContents.send('meeting-alert-data', meeting);
  });
}

function openAutoJoinToast(meeting) {
  if (autoJoinToastWindow && !autoJoinToastWindow.isDestroyed()) autoJoinToastWindow.close();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  autoJoinToastWindow = new BrowserWindow({
    width: 340, height: 52,
    x: sw - 356, y: sh - 68,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, hasShadow: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  autoJoinToastWindow.loadFile(path.join(__dirname, '../renderer/autojoin-toast.html'));
  autoJoinToastWindow.on('closed', () => { autoJoinToastWindow = null; });
  autoJoinToastWindow.webContents.once('did-finish-load', () => {
    autoJoinToastWindow?.webContents.send('autojoin-toast', { title: meeting.title });
  });
}

function openBotLeftToast(data) {
  if (botLeftToastWindow && !botLeftToastWindow.isDestroyed()) botLeftToastWindow.close();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  botLeftToastWindow = new BrowserWindow({
    width: 340, height: 100,
    x: sw - 356, y: sh - 116,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, hasShadow: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  botLeftToastWindow.loadFile(path.join(__dirname, '../renderer/bot-left-toast.html'));
  botLeftToastWindow.on('closed', () => { botLeftToastWindow = null; });
  botLeftToastWindow.webContents.once('did-finish-load', () => {
    botLeftToastWindow?.webContents.send('bot-left-toast', data);
  });
}

async function autoJoinMeeting(meeting) {
  autoJoinedEventIds.add(meeting.id);
  openAutoJoinToast(meeting);
  try {
    const res = await fetch('http://localhost:3847/recall/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meeting_url:       meeting.meetLink,
        meeting_title:     meeting.title || '',
        organizer_email:   meeting.organizer?.email || '',
        calendar_event_id: meeting.id || '',
        brief: '',
      }),
    });
    const result = await res.json();
    if (result.error) {
      autoJoinToastWindow?.webContents.send('autojoin-error', result.error);
    }
  } catch (e) {
    autoJoinToastWindow?.webContents.send('autojoin-error', e.message);
  }
}

async function calendarPollTick() {
  console.log(`[calendar] Poll tick — signedIn:${hasValidGoogleToken()} time:${new Date().toISOString()}`);
  const meetings = await fetchUpcomingMeetings(60);
  cachedMeetings = meetings;
  console.log(`[calendar] Poll tick — cached ${meetings.length} meetings:`, meetings.map(m => `"${m.title}" @${m.startIso} meetLink:${m.meetLink ? 'yes' : 'no'}`))

  // Notify recall-setup window of upcoming meetings (all within 60 min)
  if (recallSetupWindow && !recallSetupWindow.isDestroyed()) {
    recallSetupWindow.webContents.send('upcoming-meetings-update', meetings);
  }

  // Alert for meetings starting within 15 min
  for (const m of meetings) {
    if (alertedMeetingIds.has(m.id)) continue;
    const startsIn = new Date(m.startIso).getTime() - Date.now();
    if (startsIn <= 15 * 60 * 1000) {
      alertedMeetingIds.add(m.id);
      openMeetingAlert(m);
    }
  }

  // Auto-join check
  const cfg = loadConfig();
  if (cfg.autoJoinMeetings) {
    const minutesBefore = cfg.autoJoinMinutesBefore ?? 2;
    for (const m of meetings) {
      if (!m.meetLink) continue;
      if (autoJoinedEventIds.has(m.id)) continue;
      const msBeforeStart = new Date(m.startIso).getTime() - Date.now();
      if (msBeforeStart <= minutesBefore * 60 * 1000 && msBeforeStart > -2 * 60 * 1000) {
        autoJoinMeeting(m);
        break;
      }
    }
  }
}

function startCalendarPolling() {
  if (calendarPollTimer) return;
  calendarPollTick();
  calendarPollTimer = setInterval(calendarPollTick, 30000);
}

function stopCalendarPolling() {
  if (calendarPollTimer) {
    clearInterval(calendarPollTimer);
    calendarPollTimer = null;
  }
}

function hasValidGoogleToken() {
  const auth = loadConfig().googleAuth;
  if (!auth?.accessToken) return false;
  if (!auth.expiresAt || auth.expiresAt < Date.now() + 60000) return false;
  return true;
}

async function refreshGoogleProfileData() {
  try {
    const token = await getValidAccessToken();
    if (!token) return null;
    const res = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (data.error) {
      console.error('[oauth] refreshGoogleProfileData — userinfo error:', data.error.message || JSON.stringify(data.error));
      return null;
    }
    const profile = {
      name:  data.name    || '',
      email: data.email   || '',
      photo: data.picture || '',
    };
    const config = loadConfig();
    if (!config.googleAuth) return null;
    config.googleAuth = { ...config.googleAuth, ...profile };
    saveConfig(config);
    return config.googleAuth;
  } catch (e) {
    console.error('[oauth] profile refresh error:', e.message);
    return null;
  }
}

function notifyAuthChange(profile) {
  BrowserWindow.getAllWindows().forEach(w => {
    w.webContents.send('google-auth-complete', profile);
  });
  if (profile) {
    startCalendarPolling();
  } else {
    stopCalendarPolling();
  }
}

// ─── Window: Top Bar ───────────────────────────────────────────────────────────
function createTopBar() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  topBarWindow = new BrowserWindow({
    width,
    height: 68,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  topBarWindow.loadFile(path.join(__dirname, '../renderer/topbar.html'));
  topBarWindow.hide();
}

// ─── Window: Sidebar ──────────────────────────────────────────────────────────
function createSidebar() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const sidebarWidth = Math.round(width * 0.32);

  sidebarWindow = new BrowserWindow({
    width: sidebarWidth,
    height,
    x: width - sidebarWidth,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  sidebarWindow.loadFile(path.join(__dirname, '../renderer/sidebar.html'));
  sidebarWindow.hide();
}

// ─── Window: Eyeline pill ─────────────────────────────────────────────────────
function createEyeline() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const pillW = 450;
  const pillH = 52;

  eyelineWindow = new BrowserWindow({
    width: pillW,
    height: pillH,
    x: Math.round((width - pillW) / 2),
    y: 8,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  eyelineWindow.loadFile(path.join(__dirname, '../renderer/eyeline.html'));
  eyelineWindow.setIgnoreMouseEvents(true, { forward: true });
  eyelineWindow.hide();
}

// ─── Window: Spotlight ────────────────────────────────────────────────────────
function createSpotlight() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const w = 600;
  const h = 56;

  spotlightWindow = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round((width - w) / 2),
    y: Math.round(height * 0.35),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  spotlightWindow.loadFile(path.join(__dirname, '../renderer/spotlight.html'));
  spotlightWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  spotlightWindow.hide();

  // Hide on blur (click outside)
  spotlightWindow.on('blur', () => spotlightWindow.hide());
}

// ─── Window: OAuth prompt ─────────────────────────────────────────────────────
function openOAuthWindow() {
  if (oauthWindow) { oauthWindow.focus(); return; }
  oauthWindow = new BrowserWindow({
    width: 480,
    height: 340,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  oauthWindow.loadFile(path.join(__dirname, '../renderer/oauth.html'));
  oauthWindow.on('closed', () => { oauthWindow = null; });
}

// ─── Mode management ──────────────────────────────────────────────────────────
function setMode(mode) {
  awarenessMode = (mode === 'awareness');
  eyelineMode   = (mode === 'eyeline');

  if (awarenessMode) {
    sidebarWindow?.show();
    // Restore collapsed state
    const cfg = loadConfig();
    if (cfg.sidebarCollapsed) {
      const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
      sidebarWindow.setBounds({ x: sw - 42, y: 24, width: 42, height: 80 });
      sidebarWindow?.webContents.send('sidebar-collapsed-state', true);
    }
  } else {
    sidebarWindow?.hide();
  }

  if (eyelineMode) {
    eyelineWindow?.show();
    const behavior = loadConfig().eyelineBehavior || 'passive';
    eyelineWindow?.webContents.send('eyeline-behavior', behavior);
  } else {
    eyelineWindow?.hide();
  }

  topBarWindow?.hide();
  topBarWindow?.webContents.send('awareness-mode', awarenessMode);

  updateTrayMenu();
}

// ─── Global hotkeys ───────────────────────────────────────────────────────────
function registerHotkeys(queryCombo, dismissCombo) {
  globalShortcut.unregisterAll();

  const ok = globalShortcut.register(queryCombo, () => {
    if (awarenessMode) {
      sidebarWindow?.show();
      sidebarWindow?.webContents.send('focus-query');
    } else if (spotlightWindow) {
      if (spotlightWindow.isVisible()) {
        spotlightWindow.hide();
      } else {
        const { width, height: sh } = screen.getPrimaryDisplay().workAreaSize;
        spotlightWindow.setBounds({
          x: Math.round((width - 600) / 2),
          y: Math.round(sh * 0.35),
          width: 600,
          height: 56,
        });
        app.focus({ steal: true });
        spotlightWindow.show();
        spotlightWindow.focus();
        spotlightWindow.webContents.send('spotlight-clear');
      }
    }
  });
  if (!ok) console.error(`[hotkey] Failed to register query: ${queryCombo}`);

  if (dismissCombo && dismissCombo !== queryCombo) {
    const dk = globalShortcut.register(dismissCombo, () => {
      if (spotlightWindow?.isVisible()) {
        spotlightWindow.hide();
      } else if (topBarWindow?.isVisible()) {
        topBarWindow.hide();
      } else if (eyelineMode) {
        eyelineWindow?.webContents.send('eyeline-dismiss');
      }
    });
    if (!dk) console.error(`[hotkey] Failed to register dismiss: ${dismissCombo}`);
  }
}

// Legacy alias
function registerHotkey(combo) {
  registerHotkeys(combo, loadConfig().dismissHotkey || 'Escape');
}

function toggleCoaching() {
  const config = loadConfig();
  coachingMode = !coachingMode;
  const coachCfg = { ...(config.coaching || {}), enabled: coachingMode };
  config.coaching = coachCfg;
  saveConfig(config);
  setCoachingCfg(coachCfg);
  updateTrayMenu();
}

// ─── Tray menu ────────────────────────────────────────────────────────────────
function trayMenuState() {
  return {
    mode: awarenessMode ? 'awareness' : eyelineMode ? 'eyeline' : 'passive',
    coaching: coachingMode,
    sessionActive: activeSessions.size > 0,
    sessions: [...activeSessions.entries()].map(([botId, s]) => ({ botId, ...s })),
    botOnlyMeetingUrl: [...activeSessions.values()].find(s => s.botOnly)?.meetingUrl || null,
  };
}

function updateTrayMenu() {
  if (trayMenuWindow && !trayMenuWindow.isDestroyed()) {
    trayMenuWindow.webContents.send('tray-state-update', trayMenuState());
  }
}

function closeTrayMenuWindow() {
  if (trayMenuWindow && !trayMenuWindow.isDestroyed()) {
    trayMenuWindow.destroy();
    trayMenuWindow = null;
  }
}

function openTrayMenu() {
  if (trayMenuWindow && !trayMenuWindow.isDestroyed()) {
    closeTrayMenuWindow();
    return;
  }
  const { x: tx, y: ty, width: tw, height: th } = tray.getBounds();
  const winW = 268;
  const { width: dw } = screen.getPrimaryDisplay().workAreaSize;
  const posX = Math.min(Math.max(Math.round(tx + tw / 2 - winW / 2), 8), dw - winW - 8);
  const posY = ty + th + 4;
  const opts = {
    width: winW,
    height: 600,
    x: posX,
    y: posY,
    frame: false,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    titleBarStyle: 'customButtonsOnHover',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  };
  if (process.platform === 'darwin') {
    opts.vibrancy = 'menu';
    opts.visualEffectState = 'followWindow';
  }
  trayMenuWindow = new BrowserWindow(opts);
  trayMenuWindow.once('ready-to-show', () => trayMenuWindow?.show());
  trayMenuWindow.loadFile(path.join(__dirname, '../renderer/tray-menu.html'));
  trayMenuWindow.on('blur', () => setTimeout(() => closeTrayMenuWindow(), 120));
  trayMenuWindow.on('closed', () => { trayMenuWindow = null; });
  trayMenuWindow.webContents.once('did-finish-load', () => {
    trayMenuWindow?.webContents.send('tray-state-update', trayMenuState());
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../assets/tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Kalara');
  tray.on('click', openTrayMenu);
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

// Frameless window controls (projects, etc.): close / minimize / maximize
ipcMain.on('window-control', (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  if (action === 'close') win.close();
  else if (action === 'minimize') win.minimize();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
});

ipcMain.on('hide-topbar', () => topBarWindow?.hide());

ipcMain.on('resize-topbar', (event, height) => {
  if (topBarWindow) {
    const { width } = screen.getPrimaryDisplay().workAreaSize;
    topBarWindow.setSize(width, height);
  }
});

// Eyeline: mouse event passthrough toggle
ipcMain.on('eyeline-mouse', (event, ignore) => {
  eyelineWindow?.setIgnoreMouseEvents(ignore, { forward: true });
});

// Eyeline: resize between small (450×52) and large (780×80)
ipcMain.on('eyeline-resize', (event, size) => {
  if (!eyelineWindow) return;
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  const w = size === 'large' ? 780 : 450;
  const h = size === 'large' ? 80  : 52;
  eyelineWindow.setBounds({ x: Math.round((sw - w) / 2), y: 8, width: w, height: h });
});

// Eyeline: expand to full topbar
ipcMain.on('eyeline-expand', (event, payload) => {
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  topBarWindow?.setSize(sw, 68);
  topBarWindow?.webContents.send('new-answer', { ...payload, awarenessMode });
  topBarWindow?.show();
});

// Spotlight: submit query → route answer to active display
ipcMain.on('spotlight-submit', async (event, question) => {
  spotlightWindow?.hide();
  try {
    const res = await fetch('http://localhost:3847/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const result = await res.json();
    if (!result.answer) return;
    const payload = { question, ...result };
    if (eyelineMode) {
      eyelineWindow?.webContents.send('eyeline-answer', payload);
    } else {
      topBarWindow?.webContents.send('new-answer', { ...payload, awarenessMode });
      topBarWindow?.show();
    }
  } catch (e) {
    console.error('[spotlight] query error:', e.message);
  }
});

ipcMain.on('spotlight-close', () => spotlightWindow?.hide());

// Coaching config
ipcMain.on('save-coaching-config', (event, cfg) => {
  const config = loadConfig();
  config.coaching = cfg;
  saveConfig(config);
  setCoachingCfg(cfg);
});

// Google OAuth — direct browser launch, no intermediate popup
ipcMain.on('google-connect', () => {
  console.log('[oauth] google-connect IPC received');
  const url = buildGoogleAuthUrl();
  if (!url) {
    console.error('[oauth] ERROR: GOOGLE_CLIENT_ID is not set in .env — cannot start OAuth flow.');
    console.error('[oauth] ERROR: Cannot build auth URL.', {
      hasClientId:     !!process.env.GOOGLE_CLIENT_ID,
      hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    });
    return;
  }
  console.log('[oauth] Calling shell.openExternal →', url.slice(0, 100) + '…');
  shell.openExternal(url)
    .then(() => console.log('[oauth] shell.openExternal succeeded'))
    .catch(e  => console.error('[oauth] shell.openExternal failed:', e.message));
});

ipcMain.on('google-start-auth', () => {
  console.log('[oauth] google-start-auth IPC received');
  const url = buildGoogleAuthUrl();
  if (!url) {
    console.error('[oauth] ERROR: GOOGLE_CLIENT_ID is not set in .env — OAuth cannot start.');
    // Notify the oauth window so the user sees feedback
    oauthWindow?.webContents.send('oauth-error', 'GOOGLE_CLIENT_ID not configured');
    return;
  }
  console.log('[oauth] Opening browser →', url.slice(0, 80) + '…');
  shell.openExternal(url).catch(e => console.error('[oauth] openExternal error:', e.message));
});

ipcMain.on('google-disconnect', () => {
  console.log('[oauth] google-disconnect: clearing stored tokens');
  const config = loadConfig();
  delete config.googleAuth;
  saveConfig(config);
  notifyAuthChange(null);
  stopCalendarPolling();
});

ipcMain.handle('get-google-profile', () => {
  return loadConfig().googleAuth || null;
});

ipcMain.handle('refresh-google-profile', async () => {
  const updated = await refreshGoogleProfileData();
  // Only broadcast if we actually got a name or email — prevents feedback loops
  // when profile fetch fails and returns an object with all empty fields.
  if (updated?.name || updated?.email) notifyAuthChange(updated);
  return updated;
});

ipcMain.handle('get-google-auth-status', () => {
  const auth = loadConfig().googleAuth;
  if (!auth?.accessToken) return { signedIn: false };
  return { signedIn: true, name: auth.name || '', email: auth.email || '', photo: auth.photo || '' };
});

ipcMain.on('close-oauth-window', () => oauthWindow?.close());

// Calendar: get upcoming meetings on demand
ipcMain.handle('get-upcoming-meetings', async () => {
  return fetchUpcomingMeetings(60);
});

// Calendar: return cached meetings (no API call)
ipcMain.handle('get-cached-meetings', () => cachedMeetings);

// ─── Doc preview ────────────────────────────────────────────────────────────
ipcMain.on('open-doc-preview', (_, { filePath, fileName }) => {
  if (docPreviewWindow && !docPreviewWindow.isDestroyed()) {
    docPreviewWindow.close();
  }
  docPreviewFilePath = filePath;
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  docPreviewWindow = new BrowserWindow({
    width: 800,
    height: 900,
    x: Math.round((sw - 800) / 2),
    y: Math.round((sh - 900) / 2),
    frame: false,
    transparent: false,
    backgroundColor: '#131318',
    resizable: true,
    skipTaskbar: true,
    hasShadow: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  docPreviewWindow.loadFile(path.join(__dirname, '../renderer/doc-preview.html'));
  docPreviewWindow.on('closed', () => { docPreviewWindow = null; docPreviewFilePath = null; });
});

ipcMain.handle('get-preview-file-path', () => docPreviewFilePath);

ipcMain.on('open-in-default-app', (_, filePath) => {
  shell.openPath(filePath).catch(e => console.error('[preview] openPath error:', e.message));
});

ipcMain.handle('get-fresh-meetings', async () => {
  const meetings = await fetchUpcomingMeetings(60);
  cachedMeetings = meetings;
  return meetings;
});

// Tray: open recall setup and prefill URL
ipcMain.on('tray-prefill-meeting-url', (_, url) => {
  closeTrayMenuWindow();
  openRecallSetup(url);
});

// Meeting alert action: start session, snooze, or dismiss
ipcMain.on('meeting-alert-action', (event, { action, meetLink, projectId, meetingData }) => {
  if (action === 'snooze') {
    meetingAlertWindow?.close();
    if (meetingData) setTimeout(() => openMeetingAlert(meetingData), 5 * 60 * 1000);
    return;
  }
  meetingAlertWindow?.close();
  if (action === 'start') {
    openRecallSetup(meetLink, projectId || null);
  }
  if (action === 'send-bot') {
    fetch('http://localhost:3847/recall/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meeting_url:       meetLink,
        meeting_title:     meetingData?.title || '',
        organizer_email:   meetingData?.organizer?.email || '',
        calendar_event_id: meetingData?.id || '',
        project_id:        projectId || null,
        brief:             '',
        bot_only:          true,
      }),
    }).catch(() => {});
  }
});

// Sidebar collapse/expand
ipcMain.on('sidebar-resize', (event, { collapsed, avatarCount }) => {
  if (!sidebarWindow) return;
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const fullWidth  = Math.round(sw * 0.32);
  const collapsedW = Math.round(42 * 1.3); // 30% wider = ~55px
  const itemH = 24, gap = 4, padding = 12, iconH = 24, iconGap = 12;
  // Include +N overflow bubble as an extra slot when avatarCount > 5
  const count = avatarCount || 0;
  const n = Math.min(count, 5) + (count > 5 ? 1 : 0);
  const drawerH = padding + iconH + iconGap + (n > 0 ? n * itemH + (n - 1) * gap : 0) + padding;
  if (collapsed) {
    sidebarWindow.setBounds({ x: sw - collapsedW, y: 24, width: collapsedW, height: Math.max(drawerH, 72) }, true);
  } else {
    sidebarWindow.setBounds({ x: sw - fullWidth, y: 0, width: fullWidth, height: sh }, true);
  }
  const config = loadConfig();
  config.sidebarCollapsed = collapsed;
  saveConfig(config);
});

// Engagement config
ipcMain.on('save-engagement-config', (event, cfg) => {
  const config = loadConfig();
  config.engagement = cfg;
  saveConfig(config);
  setEngagementCfg(cfg);
});

// Eyeline behavior
ipcMain.on('save-eyeline-behavior', (event, behavior) => {
  const config = loadConfig();
  config.eyelineBehavior = behavior;
  saveConfig(config);
  eyelineWindow?.webContents.send('eyeline-behavior', behavior);
});

// Display config
ipcMain.on('save-bot-name', (event, name) => {
  const config = loadConfig();
  config.botName = name || '';
  saveConfig(config);
});

ipcMain.on('save-autojoin-config', (event, cfg) => {
  const config = loadConfig();
  config.autoJoinMeetings       = cfg.autoJoinMeetings;
  config.autoJoinMinutesBefore  = cfg.autoJoinMinutesBefore;
  saveConfig(config);
});

ipcMain.on('autojoin-cancel', () => {
  fetch('http://localhost:3847/recall/end', { method: 'POST' }).catch(() => {});
});

ipcMain.on('save-display-config', (event, cfg) => {
  const config = loadConfig();
  config.display = { ...(config.display || {}), ...cfg };
  saveConfig(config);
  const val = config.display.showConfidence || false;
  topBarWindow?.webContents.send('show-confidence', val);
  sidebarWindow?.webContents.send('show-confidence', val);
  eyelineWindow?.webContents.send('show-confidence', val);
});

// Web search config: save to disk and update webhook.js in-process
ipcMain.on('save-web-search-config', (event, cfg) => {
  const config = loadConfig();
  config.webSearch = cfg;
  saveConfig(config);
  setWebSearchConfig(cfg);
});

// Theme: save and broadcast to all windows
ipcMain.on('save-theme', (event, theme) => {
  const config = loadConfig();
  config.theme = theme;
  saveConfig(config);
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send('theme-change', theme));
});

// Open settings (from sidebar gear icon or tray menu)
ipcMain.on('open-settings', () => openSettings());
ipcMain.on('settings-minimize', () => settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.minimize());
ipcMain.on('settings-fullscreen', () => {
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  settingsWindow.setFullScreen(!settingsWindow.isFullScreen());
});

// ─── Tray menu IPC ────────────────────────────────────────────────────────────
ipcMain.handle('get-tray-state', () => trayMenuState());
ipcMain.on('tray-set-mode',         (_, mode) => setMode(mode));
ipcMain.on('tray-toggle-coaching',  ()         => toggleCoaching());
ipcMain.on('tray-open-projects',    ()         => { closeTrayMenuWindow(); openProjects(); });
// tray-open-doc-manager removed — doc management is now inline in Manage Projects window
ipcMain.on('tray-open-recall-setup',()         => { closeTrayMenuWindow(); openRecallSetup(); });
ipcMain.on('tray-end-session', (_, botId) => {
  if (botId) {
    fetch('http://localhost:3847/recall/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_id: botId }),
    }).catch(() => {});
  } else if (activeSessions.size > 1) {
    openEndSessionPicker();
  } else {
    fetch('http://localhost:3847/recall/end', { method: 'POST' }).catch(() => {});
  }
});
ipcMain.on('keep-session-active', () => {
  autoEndToastWindow?.close();
  autoEndToastWindow = null;
});
ipcMain.on('tray-open-settings',    ()         => { closeTrayMenuWindow(); openSettings(); });
ipcMain.on('tray-quit',             ()         => app.quit());
ipcMain.on('close-tray-menu',       ()         => closeTrayMenuWindow());
ipcMain.on('resize-tray-menu', (_, h) => {
  if (!trayMenuWindow || trayMenuWindow.isDestroyed()) return;
  const { height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const { x, y, width } = trayMenuWindow.getBounds();
  const safeH = Math.min(h, sh - y - 8);
  trayMenuWindow.setBounds({ x, y, width, height: safeH });
});

// Settings: provide current config
ipcMain.handle('get-config', () => loadConfig());

// Settings: save hotkey and re-register immediately
ipcMain.on('save-hotkey', (event, combo) => {
  const config = loadConfig();
  config.hotkey = combo;
  saveConfig(config);
  registerHotkeys(combo, config.dismissHotkey || 'Escape');
});

// Settings: save dismiss hotkey
ipcMain.on('save-dismiss-hotkey', (event, combo) => {
  const config = loadConfig();
  config.dismissHotkey = combo;
  saveConfig(config);
  registerHotkeys(config.hotkey || 'CommandOrControl+Shift+Space', combo);
});

// Settings: save auto-dismiss timer
ipcMain.on('save-dismiss-timer', (event, ms) => {
  const config = loadConfig();
  config.dismissMs = ms;
  saveConfig(config);
  topBarWindow?.webContents.send('dismiss-timer-update', ms);
});

// ─── Utility windows ──────────────────────────────────────────────────────────
function openProjects() {
  const win = new BrowserWindow({
    width: 520, height: 640,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, '../renderer/projects.html'));
}


function openRecallSetup(prefillUrl = null, prefillProjectId = null) {
  if (recallSetupWindow && !recallSetupWindow.isDestroyed()) {
    recallSetupWindow.show();
    recallSetupWindow.focus();
    if (prefillUrl) recallSetupWindow.webContents.send('prefill-meeting-url', prefillUrl);
    if (prefillProjectId) recallSetupWindow.webContents.send('prefill-project', prefillProjectId);
    return;
  }
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  recallSetupWindow = new BrowserWindow({
    width: 480,
    height: 680,
    x: Math.round((sw - 480) / 2),
    y: Math.round((sh - 680) / 2),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  recallSetupWindow.loadFile(path.join(__dirname, '../renderer/recall-setup.html'));
  recallSetupWindow.on('closed', () => { recallSetupWindow = null; });
  recallSetupWindow.webContents.once('did-finish-load', () => {
    if (prefillUrl) recallSetupWindow?.webContents.send('prefill-meeting-url', prefillUrl);
    if (prefillProjectId) recallSetupWindow?.webContents.send('prefill-project', prefillProjectId);
    fetchUpcomingMeetings(60).then(meetings => {
      recallSetupWindow?.webContents.send('upcoming-meetings-update', meetings);
    }).catch(() => {});
  });
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  const { x: tx, y: ty, width: tw, height: th } = tray.getBounds();
  const winW = 520;
  const { width: dw } = screen.getPrimaryDisplay().workAreaSize;
  const posX = Math.min(Math.max(Math.round(tx + tw / 2 - winW / 2), 8), dw - winW - 8);
  const posY = ty + th + 4;
  settingsWindow = new BrowserWindow({
    width: winW,
    height: 580,
    x: posX,
    y: posY,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    titleBarStyle: 'customButtonsOnHover',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));
  settingsWindow.on('blur', () => settingsWindow?.hide());
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function openAutoEndToast(botId) {
  if (autoEndToastWindow && !autoEndToastWindow.isDestroyed()) return;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  autoEndToastWindow = new BrowserWindow({
    width: 340, height: 72,
    x: width - 356, y: height - 88,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, hasShadow: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  autoEndToastWindow.loadFile(path.join(__dirname, '../renderer/auto-end-toast.html'));
  autoEndToastWindow.on('closed', () => { autoEndToastWindow = null; });
  autoEndToastWindow.webContents.once('did-finish-load', () => {
    autoEndToastWindow?.webContents.send('auto-end-toast', { botId });
  });
}

function openEndSessionPicker() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: 360, height: 220,
    x: Math.round((sw - 360) / 2), y: Math.round(sh * 0.3),
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, hasShadow: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, '../renderer/end-session-picker.html'));
  win.webContents.once('did-finish-load', () => {
    const sessionList = [...activeSessions.entries()].map(([botId, s]) => ({ botId, ...s }));
    win.webContents.send('session-list', sessionList);
  });
}

function openPostSearchReview() {
  if (postSearchWindow && !postSearchWindow.isDestroyed()) {
    postSearchWindow.focus();
    return;
  }
  postSearchWindow = new BrowserWindow({
    width: 640, height: 580,
    title: 'Post-Call Review',
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  postSearchWindow.loadFile(path.join(__dirname, '../renderer/postsearch-review.html'));
  postSearchWindow.on('closed', () => { postSearchWindow = null; });
}

function openCallSummary(callId, projectId) {
  const DOCS_BASE = path.join(__dirname, '../../docs');
  const summaryPath = path.join(DOCS_BASE, 'projects', projectId, 'call-history', `${callId}-summary.json`);
  let summaryData;
  try {
    summaryData = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  } catch (e) {
    summaryData = { error: 'Could not load summary.' };
  }
  const win = new BrowserWindow({
    width: 560, height: 640,
    title: 'Call Summary',
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, '../renderer/call-summary.html'));
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('call-summary-data', summaryData);
  });
}

ipcMain.on('open-call-summary', (event, { callId, projectId }) => {
  if (callId && projectId) openCallSummary(callId, projectId);
});

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createTopBar();
  createSidebar();
  createEyeline();
  createSpotlight();
  createTray();

  const config = loadConfig();
  registerHotkeys(config.hotkey || 'CommandOrControl+Shift+Space', config.dismissHotkey || 'Escape');
  setWebSearchConfig(config.webSearch || {});
  if (config.coaching) {
    coachingMode = config.coaching.enabled || false;
    setCoachingCfg(config.coaching);
  }
  if (config.engagement) {
    setEngagementCfg(config.engagement);
  }

  // Google OAuth: silent token refresh if near expiry
  if (config.googleAuth?.refreshToken) {
    const timeLeft = (config.googleAuth.expiresAt || 0) - Date.now();
    if (timeLeft < 300000) {
      refreshGoogleToken(config.googleAuth.refreshToken).then(tokens => {
        if (tokens?.access_token) {
          config.googleAuth.accessToken = tokens.access_token;
          config.googleAuth.expiresAt   = Date.now() + (tokens.expires_in || 3600) * 1000;
          saveConfig(config);
        }
      }).catch(() => {});
    }
  }

  // Start calendar polling if already signed in; sign-in prompt now lives in the tray menu
  setTimeout(() => {
    if (hasValidGoogleToken()) {
      console.log('[oauth] Startup: valid token found — starting calendar polling');
      startCalendarPolling();
      const auth = loadConfig().googleAuth;
      if (!auth?.name && !auth?.email) {
        console.log('[oauth] Startup: profile fields empty — refreshing from Google');
        refreshGoogleProfileData()
          .then(p => { if (p) notifyAuthChange(p); })
          .catch(() => {});
      }
    } else {
      console.log('[oauth] Startup: no valid token — sign in via tray menu');
    }
  }, 2000);

  // Broadcast saved theme to all windows once ready
  const savedTheme = config.theme || 'dark';
  setTimeout(() => {
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('theme-change', savedTheme));
  }, 1200);

  // Send display config once windows are ready
  app.on('browser-window-created', () => {});
  setTimeout(() => {
    const showConf = config.display?.showConfidence || false;
    const dismissMs = config.dismissMs ?? 12000;
    topBarWindow?.webContents.send('show-confidence', showConf);
    topBarWindow?.webContents.send('dismiss-timer-update', dismissMs);
    sidebarWindow?.webContents.send('show-confidence', showConf);
    eyelineWindow?.webContents.send('show-confidence', showConf);
    if (eyelineMode) {
      eyelineWindow?.webContents.send('eyeline-behavior', config.eyelineBehavior || 'passive');
    }
  }, 1000);

  startWebhookServer(3847, (event, payload) => {
    if (event === 'answer') {
      if (eyelineMode) {
        eyelineWindow?.webContents.send('eyeline-answer', payload);
      } else {
        topBarWindow?.webContents.send('new-answer', { ...payload, awarenessMode });
        topBarWindow?.show();
        if (awarenessMode) sidebarWindow?.webContents.send('new-answer', payload);
      }
    }
    if (event === 'transcript') {
      if (awarenessMode) sidebarWindow?.webContents.send('transcript-update', payload);
      if (eyelineMode) eyelineWindow?.webContents.send('eyeline-transcript', payload);
    }
    if (event === 'participant-suggestion') {
      topBarWindow?.webContents.send('participant-suggestion', payload);
      topBarWindow?.show();
    }
    if (event === 'post-search-ready') {
      openPostSearchReview();
    }
    if (event === 'coaching-nudge') {
      if (awarenessMode) {
        sidebarWindow?.webContents.send('coaching-nudge', payload);
      } else if (eyelineMode) {
        eyelineWindow?.webContents.send('coaching-nudge', payload);
      } else {
        topBarWindow?.webContents.send('coaching-nudge', payload);
        topBarWindow?.show();
      }
    }
    if (event === 'bot-left-call') {
      // Bot confirmed call ended — show toast, then end session
      autoEndToastWindow?.close(); autoEndToastWindow = null;
      const sess = activeSessions.get(payload.botId);
      if (sess) openBotLeftToast({ title: sess.meetingTitle, callId: sess.callId, projectId: sess.projectId, botOnly: sess.botOnly });
      fetch('http://localhost:3847/recall/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_id: payload.botId || undefined }),
      }).catch(() => {});
    }
    if (event === 'user-left-call') {
      // User left their call — show countdown toast (unless bot-only session)
      const session = activeSessions.get(payload.botId);
      if (session && !session.botOnly) {
        openAutoEndToast(payload.botId);
      }
    }
    if (event === 'session-started') {
      activeSessions.set(payload.botId, {
        meetingUrl:   payload.meetingUrl || null,
        meetingTitle: payload.meetingTitle || null,
        botOnly:      payload.botOnly || false,
        projectId:    payload.projectId || null,
        callId:       payload.callId || null,
      });
      if (!payload.botOnly && payload.meetingUrl) shell.openExternal(payload.meetingUrl).catch(() => {});
      if (payload.projectId) {
        const cfg = loadConfig(); cfg.lastProjectId = payload.projectId; saveConfig(cfg);
      }
      updateTrayMenu();
    }
    if (event === 'session-ended') {
      activeSessions.delete(payload.botId);
      if (activeSessions.size === 0 && hasValidGoogleToken()) startCalendarPolling();
      updateTrayMenu();
    }
    if (event === 'engagement-score') {
      sidebarWindow?.webContents.send('engagement-score', payload);
    }
    if (event === 'participant-joined') {
      sidebarWindow?.webContents.send('participant-joined', payload);
    }
    if (event === 'participant-left') {
      sidebarWindow?.webContents.send('participant-left', payload);
    }
  }, (profile) => {
    oauthWindow?.close();
    notifyAuthChange(profile);
    startCalendarPolling();
  });
});

app.on('window-all-closed', (e) => e.preventDefault());

app.on('will-quit', () => globalShortcut.unregisterAll());
