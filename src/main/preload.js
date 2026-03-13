const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('brioAPI', {
  // ─── UI events ────────────────────────────────────────────────────────────
  onNewAnswer: (callback) => ipcRenderer.on('new-answer', (_, payload) => callback(payload)),
  onTranscriptUpdate: (callback) => ipcRenderer.on('transcript-update', (_, payload) => callback(payload)),
  onParticipantSuggestion: (callback) => ipcRenderer.on('participant-suggestion', (_, payload) => callback(payload)),
  onAwarenessMode: (callback) => ipcRenderer.on('awareness-mode', (_, value) => callback(value)),
  hideTopBar: () => ipcRenderer.send('hide-topbar'),
  resizeTopBar: (height) => ipcRenderer.send('resize-topbar', height),
  resizeTopBarWidth: (width) => ipcRenderer.send('resize-topbar-width', width),
  setTopBarPosition: (x, y) => ipcRenderer.send('topbar-set-position', x, y),

  // ─── Mid-call project switch ──────────────────────────────────────────────
  activateProject: (projectId) =>
    fetch('http://localhost:3847/project/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId }),
    }).then(r => r.json()),

  // ─── Projects ─────────────────────────────────────────────────────────────
  getProjects: () =>
    fetch('http://localhost:3847/projects').then(r => r.json()),

  createProject: (name) =>
    fetch('http://localhost:3847/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(r => r.json()),

  deleteProject: (id) =>
    fetch(`http://localhost:3847/projects/${id}`, { method: 'DELETE' }).then(r => r.json()),

  // ─── Project docs ──────────────────────────────────────────────────────────
  getProjectDocs: (projectId) =>
    fetch(`http://localhost:3847/projects/${projectId}/docs`).then(r => r.json()),

  uploadProjectDoc: (projectId, formData) =>
    fetch(`http://localhost:3847/projects/${projectId}/docs/upload`, {
      method: 'POST',
      body: formData,
    }).then(r => r.json()),

  deleteProjectDoc: (projectId, storedName) =>
    fetch(`http://localhost:3847/projects/${projectId}/docs/${storedName}`, {
      method: 'DELETE',
    }).then(r => r.json()),

  // ─── Call docs (call-specific layer) ──────────────────────────────────────
  getCallDocs: () =>
    fetch('http://localhost:3847/call/docs').then(r => r.json()),

  uploadCallDoc: (formData) =>
    fetch('http://localhost:3847/call/docs/upload', { method: 'POST', body: formData }).then(r => r.json()),

  clearCallDocs: () =>
    fetch('http://localhost:3847/call/docs', { method: 'DELETE' }).then(r => r.json()),

  // ─── Recall ────────────────────────────────────────────────────────────────
  startRecall: (meetingUrl, projectId, brief) =>
    fetch('http://localhost:3847/recall/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting_url: meetingUrl, project_id: projectId, brief }),
    }).then(r => r.json()),

  // ─── Manual query ──────────────────────────────────────────────────────────
  query: (question, context, manualProjectId) =>
    fetch('http://localhost:3847/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, ...(context ? { context } : {}), ...(manualProjectId ? { manualProjectId } : {}) }),
    }).then(r => r.json()),

  checkAmbiguity: (question) =>
    fetch('http://localhost:3847/query/check-ambiguity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    }).then(r => r.json()),

  queryAlternatives: (question, previousAnswer) =>
    fetch('http://localhost:3847/query/alternatives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, previousAnswer }),
    }).then(r => r.json()),

  // ─── Eyeline pill ──────────────────────────────────────────────────────────
  onEyelineAnswer:       (cb) => ipcRenderer.on('eyeline-answer', (_, payload) => cb(payload)),
  setEyelineMouseEvents: (ignore) => ipcRenderer.send('eyeline-mouse', ignore),
  eyelineResize:         (size) => ipcRenderer.send('eyeline-resize', size),
  eyelineExpand:         (payload) => ipcRenderer.send('eyeline-expand', payload),

  // ─── Spotlight ─────────────────────────────────────────────────────────────
  submitSpotlightQuery: (question) => ipcRenderer.send('spotlight-submit', question),
  closeSpotlight:       () => ipcRenderer.send('spotlight-close'),
  onSpotlightClear:     (cb) => ipcRenderer.on('spotlight-clear', () => cb()),

  // ─── Settings ──────────────────────────────────────────────────────────────
  getConfig:          () => ipcRenderer.invoke('get-config'),
  saveHotkey:         (combo) => ipcRenderer.send('save-hotkey', combo),
  saveWebSearchConfig:(cfg)   => ipcRenderer.send('save-web-search-config', cfg),
  saveTheme:          (theme) => ipcRenderer.send('save-theme', theme),
  onThemeChange:      (cb)    => ipcRenderer.on('theme-change', (_, t) => cb(t)),
  openSettings:             () => ipcRenderer.send('open-settings'),
  settingsMinimize:         () => ipcRenderer.send('settings-minimize'),
  settingsToggleFullScreen: () => ipcRenderer.send('settings-fullscreen'),

  // ─── Pre-call prepare ──────────────────────────────────────────────────────
  prepareCallContext: (brief) =>
    fetch('http://localhost:3847/recall/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief }),
    }).then(r => r.json()),

  // ─── Session end ───────────────────────────────────────────────────────────
  endSession: (botId) =>
    fetch('http://localhost:3847/recall/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(botId ? { bot_id: botId } : {}),
    }).then(r => r.json()),

  keepSessionActive: () => ipcRenderer.send('keep-session-active'),
  onAutoEndToast: (cb) => ipcRenderer.on('auto-end-toast', (_, d) => cb(d)),
  onBotLeftToast: (cb) => ipcRenderer.on('bot-left-toast', (_, d) => cb(d)),
  botLeftToastDismiss: () => ipcRenderer.send('bot-left-toast-dismiss'),
  onSessionList: (cb) => ipcRenderer.on('session-list', (_, list) => cb(list)),
  openCallSummary: (callId, projectId) => ipcRenderer.send('open-call-summary', { callId, projectId }),
  onCallSummaryData: (cb) => ipcRenderer.on('call-summary-data', (_, d) => cb(d)),

  // ─── Post-search review ────────────────────────────────────────────────────
  getPostSearchResults: () =>
    fetch('http://localhost:3847/postsearch/results').then(r => r.json()),

  savePostSearchResult: (resultId, projectId) =>
    fetch('http://localhost:3847/postsearch/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resultId, projectId }),
    }).then(r => r.json()),

  // ─── Calendar autodetect ───────────────────────────────────────────────────
  getUpcomingMeetings:      () => ipcRenderer.invoke('get-upcoming-meetings'),
  getCachedMeetings:        () => ipcRenderer.invoke('get-cached-meetings'),
  getFreshMeetings:         () => ipcRenderer.invoke('get-fresh-meetings'),
  trayPrefillMeetingUrl:    (url) => ipcRenderer.send('tray-prefill-meeting-url', url),
  onUpcomingMeetingsUpdate: (cb) => ipcRenderer.on('upcoming-meetings-update', (_, m) => cb(m)),
  onTrayMeetingsUpdate:     (cb) => ipcRenderer.on('tray-meetings-update',     (_, m) => cb(m)),
  onPrefillMeetingUrl:      (cb) => ipcRenderer.on('prefill-meeting-url', (_, url) => cb(url)),
  onPrefillProject:         (cb) => ipcRenderer.on('prefill-project', (_, id) => cb(id)),
  meetingAlertAction:       (payload) => ipcRenderer.send('meeting-alert-action', payload),
  onMeetingAlertData:       (cb) => ipcRenderer.on('meeting-alert-data', (_, m) => cb(m)),
  openProjectDropdown:      (opts) => ipcRenderer.invoke('open-project-dropdown', opts),
  onDropdownData:           (cb) => ipcRenderer.on('dropdown-data', (_, data) => cb(data)),
  selectProject:            (item) => ipcRenderer.send('dropdown-selected', item),
  onDropdownSelected:       (cb) => ipcRenderer.on('dropdown-selected', (_, item) => cb(item)),

  // ─── Sidebar focus ─────────────────────────────────────────────────────────
  onFocusQuery: (cb) => ipcRenderer.on('focus-query', () => cb()),

  // ─── Coaching ──────────────────────────────────────────────────────────────
  saveCoachingConfig: (cfg) => ipcRenderer.send('save-coaching-config', cfg),
  onCoachingNudge:    (cb)  => ipcRenderer.on('coaching-nudge', (_, n) => cb(n)),

  // ─── Eyeline behavior ──────────────────────────────────────────────────────
  saveEyelineBehavior:  (b)  => ipcRenderer.send('save-eyeline-behavior', b),
  onEyelineBehavior:    (cb) => ipcRenderer.on('eyeline-behavior', (_, b) => cb(b)),
  onEyelineTranscript:  (cb) => ipcRenderer.on('eyeline-transcript', (_, p) => cb(p)),

  // ─── Dismiss timer + hotkey ────────────────────────────────────────────────
  saveDismissTimer:   (ms)    => ipcRenderer.send('save-dismiss-timer', ms),
  saveDismissHotkey:  (combo) => ipcRenderer.send('save-dismiss-hotkey', combo),
  onDismissTimerUpdate: (cb)  => ipcRenderer.on('dismiss-timer-update', (_, ms) => cb(ms)),
  onEyelineDismiss:   (cb)    => ipcRenderer.on('eyeline-dismiss', () => cb()),

  // ─── Display config ────────────────────────────────────────────────────────
  saveDisplayConfig: (cfg) => ipcRenderer.send('save-display-config', cfg),
  onShowConfidence:  (cb) => ipcRenderer.on('show-confidence', (_, val) => cb(val)),

  // ─── Engagement score ──────────────────────────────────────────────────────
  saveEngagementConfig: (cfg) => ipcRenderer.send('save-engagement-config', cfg),
  onEngagementScore:    (cb)  => ipcRenderer.on('engagement-score', (_, data) => cb(data)),

  // ─── Google OAuth ───────────────────────────────────────────────────────────
  connectGoogle:        () => ipcRenderer.send('google-connect'),
  startGoogleAuth:      () => ipcRenderer.send('google-start-auth'),
  disconnectGoogle:     () => ipcRenderer.send('google-disconnect'),
  closeOAuthWindow:     () => ipcRenderer.send('close-oauth-window'),
  getGoogleProfile:     () => ipcRenderer.invoke('get-google-profile'),
  refreshGoogleProfile: () => ipcRenderer.invoke('refresh-google-profile'),
  getGoogleAuthStatus:  () => ipcRenderer.invoke('get-google-auth-status'),
  onGoogleAuthComplete: (cb) => ipcRenderer.on('google-auth-complete', (_, profile) => cb(profile)),
  onOauthError:         (cb) => ipcRenderer.on('oauth-error', (_, msg) => cb(msg)),

  // ─── Sidebar collapse / participant avatars ─────────────────────────────────
  sidebarResize:        (collapsed, avatarCount) => ipcRenderer.send('sidebar-resize', { collapsed, avatarCount }),
  sidebarSetPosition:   (x, y) => ipcRenderer.send('sidebar-set-position', x, y),
  onParticipantJoined:  (cb) => ipcRenderer.on('participant-joined', (_, p) => cb(p)),
  onParticipantLeft:    (cb) => ipcRenderer.on('participant-left',   (_, p) => cb(p)),
  onSidebarCollapsedState: (cb) => ipcRenderer.on('sidebar-collapsed-state', (_, v) => cb(v)),
  onCallActive: (cb) => ipcRenderer.on('call-active', (_, active) => cb(active)),

  // ─── Window controls (frameless windows: close / minimize / maximize) ─────
  windowControl:       (action) => ipcRenderer.send('window-control', action),

  // ─── Tray menu ────────────────────────────────────────────────────────────
  getTrayState:        ()       => ipcRenderer.invoke('get-tray-state'),
  onTrayStateUpdate:   (cb)     => ipcRenderer.on('tray-state-update', (_, s) => cb(s)),
  traySetMode:         (mode)   => ipcRenderer.send('tray-set-mode', mode),
  trayToggleCoaching:  ()       => ipcRenderer.send('tray-toggle-coaching'),
  trayOpenProjects:    ()       => ipcRenderer.send('tray-open-projects'),
  trayOpenDocManager:  ()       => ipcRenderer.send('tray-open-doc-manager'),
  trayOpenRecallSetup: ()       => ipcRenderer.send('tray-open-recall-setup'),
  trayEndSession:      (botId)  => ipcRenderer.send('tray-end-session', botId || null),
  trayOpenSettings:    ()       => ipcRenderer.send('tray-open-settings'),
  trayQuit:            ()       => ipcRenderer.send('tray-quit'),
  closeTrayMenu:       ()       => ipcRenderer.send('close-tray-menu'),
  resizeTrayMenu:      (h)      => ipcRenderer.send('resize-tray-menu', h),

  // ─── Auto-join ──────────────────────────────────────────────────────────────
  saveBotName:        (name) => ipcRenderer.send('save-bot-name', name),
  saveAutoJoinConfig: (cfg) => ipcRenderer.send('save-autojoin-config', cfg),
  saveRagModel:          (model) => ipcRenderer.send('save-rag-model', model),
  saveIgnoreHostSpeaker: (value) => ipcRenderer.send('save-ignore-host-speaker', value),
  onAutoJoinToast:    (cb)  => ipcRenderer.on('autojoin-toast', (_, data) => cb(data)),
  onAutoJoinError:    (cb)  => ipcRenderer.on('autojoin-error', (_, msg) => cb(msg)),
  cancelAutoJoin:     ()    => ipcRenderer.send('autojoin-cancel'),

  // ─── Doc ingestion ──────────────────────────────────────────────────────────
  onDocIngested: (cb) => ipcRenderer.on('doc-ingested', (_, payload) => cb(payload)),

  // ─── Doc preview ────────────────────────────────────────────────────────────
  openDocPreview:      (filePath, fileName) => ipcRenderer.send('open-doc-preview', { filePath, fileName }),
  getPreviewFilePath:  () => ipcRenderer.invoke('get-preview-file-path'),
  openInDefaultApp:    (filePath) => ipcRenderer.send('open-in-default-app', filePath),

  // ─── Answer feedback ───────────────────────────────────────────────────────
  submitFeedback: (chunkIds, vote) =>
    fetch('http://localhost:3847/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunkIds, vote }),
    }).then(r => r.json()),
});
