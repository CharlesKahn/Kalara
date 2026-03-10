require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const coaching   = require('./coaching');
const engagement = require('./engagement');

// ─── Setup ─────────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ─── Paths ─────────────────────────────────────────────────────────────────────
const DOCS_BASE = path.join(__dirname, '../../docs');
const PROJECTS_FILE = path.join(DOCS_BASE, 'projects.json');
const PROJECTS_DIR = path.join(DOCS_BASE, 'projects');
const CALL_HISTORY_FILE = path.join(DOCS_BASE, 'call-history.json');
const CONFIG_FILE = path.join(DOCS_BASE, 'config.json');

// ─── Config helpers (shared with main process) ─────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch (e) {}
  return {};
}
function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); } catch (e) {}
}

// ─── Google OAuth helpers ──────────────────────────────────────────────────────
const OAUTH_REDIRECT_URI = 'http://localhost:3847/oauth/callback';

async function exchangeGoogleCode(code) {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  console.log('[oauth] exchangeGoogleCode — clientId present:', !!clientId, '| clientSecret present:', !!clientSecret);
  if (!clientId || !clientSecret) {
    console.error('[oauth] exchangeGoogleCode — missing env vars, cannot exchange');
    return null;
  }
  console.log('[oauth] exchangeGoogleCode — redirect_uri:', OAUTH_REDIRECT_URI);
  console.log('[oauth] exchangeGoogleCode — sending POST to https://oauth2.googleapis.com/token');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: OAUTH_REDIRECT_URI, grant_type: 'authorization_code',
    }),
  });
  console.log('[oauth] exchangeGoogleCode — response status:', res.status);
  const data = await res.json();
  console.log('[oauth] exchangeGoogleCode — response keys:', Object.keys(data));
  if (data.error) console.error('[oauth] exchangeGoogleCode — error:', data.error, data.error_description);
  return data;
}

async function fetchGoogleProfile(accessToken) {
  console.log('[oauth] fetchGoogleProfile — calling https://www.googleapis.com/oauth2/v2/userinfo');
  const res = await fetch(
    'https://www.googleapis.com/oauth2/v2/userinfo',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  console.log('[oauth] fetchGoogleProfile — response status:', res.status);
  const data = await res.json();
  console.log('[oauth] fetchGoogleProfile — raw response:', JSON.stringify(data));
  if (data.error) {
    throw new Error(`userinfo error: ${data.error.message || JSON.stringify(data.error)}`);
  }
  return {
    name:  data.name    || '',
    email: data.email   || '',
    photo: data.picture || '',
  };
}

let oauthCompleteCallback = null;

fs.mkdirSync(DOCS_BASE, { recursive: true });
fs.mkdirSync(PROJECTS_DIR, { recursive: true });

// ─── Anthropic client ──────────────────────────────────────────────────────────
const anthropic = new (require('@anthropic-ai/sdk'))({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── Projects persistence ──────────────────────────────────────────────────────
function loadProjects() {
  try {
    if (fs.existsSync(PROJECTS_FILE)) return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
  } catch (e) {}
  return { projects: [] };
}

function saveProjects(data) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2));
}

function loadManifest(projectId) {
  const manifestPath = path.join(PROJECTS_DIR, projectId, 'manifest.json');
  try {
    if (fs.existsSync(manifestPath)) return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e) {}
  return [];
}

function saveManifest(projectId, manifest) {
  fs.writeFileSync(path.join(PROJECTS_DIR, projectId, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

// ─── Multer: project-scoped storage ───────────────────────────────────────────
const projectStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(PROJECTS_DIR, req.params.id, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${unique}_${safeName}`);
  },
});
const projectUpload = multer({ storage: projectStorage });

// ─── Call history ──────────────────────────────────────────────────────────────
function loadCallHistory() {
  try {
    if (fs.existsSync(CALL_HISTORY_FILE)) return JSON.parse(fs.readFileSync(CALL_HISTORY_FILE, 'utf-8'));
  } catch (e) {}
  return { calls: [] };
}

function upsertCallRecord(record) {
  const history = loadCallHistory();
  const idx = history.calls.findIndex(c => c.id === record.id);
  if (idx >= 0) history.calls[idx] = record;
  else {
    history.calls.unshift(record);
    if (history.calls.length > 500) history.calls = history.calls.slice(0, 500);
  }
  fs.writeFileSync(CALL_HISTORY_FILE, JSON.stringify(history, null, 2));
}

function gravatarUrl(email, size = 48) {
  const hash = crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?d=404&s=${size}`;
}

function suggestProject(email) {
  const history = loadCallHistory();
  const counts = {};
  const lc = email.toLowerCase();
  for (const call of history.calls) {
    if (call.participantEmails?.some(e => e === lc)) {
      counts[call.projectId] = (counts[call.projectId] || 0) + 1;
    }
  }
  if (!Object.keys(counts).length) return null;
  const [bestId] = Object.entries(counts).sort(([, a], [, b]) => b - a)[0];
  const project = loadProjects().projects.find(p => p.id === bestId);
  return project ? { projectId: bestId, projectName: project.name } : null;
}

// ─── Module-level shared state ─────────────────────────────────────────────────
const BUFFER_SIZE = 20;
let webSearchCfg   = {};   // set via setWebSearchConfig()
let coachingCfg    = {};   // set via setCoachingConfig()
let preCallCache   = [];   // [{question, answer, sources}] from /recall/prepare
let postSearchResults = []; // [{id, question, answer, sources}] ready for review
let projectWeights   = {}; // { projectId: { chunkId: weight } } — in-memory cache

// ─── Session Manager ────────────────────────────────────────────────────────────
const sessions = new Map(); // Map<botId, SessionState>
let primaryBotId = null;

function createSession(botId, opts) {
  sessions.set(botId, {
    botId,
    meetingUrl: opts.meetingUrl,
    projectId:  opts.projectId || null,
    brief:      opts.brief || null,
    botOnly:    opts.botOnly || false,
    docChunks:       [],
    callDocChunks:   [],
    callAnswerLog:   [],
    zeroConfidenceLog: [],
    transcriptBuffer: [],
    currentCallRecord: null,
    suggestionMadeThisCall: false,
    previousProjectId: null,
    callHistoryContext: '',
  });
}

function getSession(botId) { return sessions.get(botId); }

function endSessionState(botId) {
  sessions.delete(botId);
  if (primaryBotId === botId) primaryBotId = [...sessions.keys()].pop() || null;
}

function getActiveSession() { return primaryBotId ? sessions.get(primaryBotId) : null; }

// ─── Text extraction ───────────────────────────────────────────────────────────
const PDF_TIMEOUT_MS = 20000;

async function extractText(source, mimetype, originalName) {
  const isPdf  = mimetype === 'application/pdf' || originalName.endsWith('.pdf');
  const isDocx = mimetype.includes('word') || originalName.endsWith('.docx');

  if (Buffer.isBuffer(source)) {
    if (isPdf) {
      const buf = source;
      const d = await Promise.race([
        pdfParse(buf),
        new Promise((_, rej) => setTimeout(() => rej(new Error('PDF extraction timed out')), PDF_TIMEOUT_MS)),
      ]);
      return d.text;
    }
    if (isDocx) { const d = await mammoth.extractRawText({ buffer: source }); return d.value; }
    return source.toString('utf-8');
  }
  if (isPdf) {
    const buf = fs.readFileSync(source);
    const d = await Promise.race([
      pdfParse(buf),
      new Promise((_, rej) => setTimeout(() => rej(new Error('PDF extraction timed out')), PDF_TIMEOUT_MS)),
    ]);
    return d.text;
  }
  if (isDocx) { const d = await mammoth.extractRawText({ path: source }); return d.value; }
  return fs.readFileSync(source, 'utf-8');
}

// ─── Chunking ──────────────────────────────────────────────────────────────────
function chunkText(text, source, chunkSize = 500, overlap = 50) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length > 50) {
      const id = crypto.createHash('sha256').update(`${source}:${chunks.length}`).digest('hex').slice(0, 12);
      chunks.push({ text: chunk, source, id });
    }
  }
  return chunks;
}

// ─── Call summaries (answer history) ──────────────────────────────────────────
function callSummariesDir(projectId) {
  return path.join(PROJECTS_DIR, projectId, 'call-summaries');
}

function saveCallSummary(projectId, callId, participantEmails, startedAt, answers) {
  if (!projectId || !callId) return;
  const dir = callSummariesDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const summary = {
    callId, projectId, participantEmails, startedAt,
    endedAt: new Date().toISOString(),
    answers: answers.filter(a => a.answer),
  };
  try {
    fs.writeFileSync(path.join(dir, `${callId}.json`), JSON.stringify(summary, null, 2));
  } catch (e) { console.error('[history] Save failed:', e.message); }
}

function buildHistoryContext(projectId, email) {
  const dir = callSummariesDir(projectId);
  if (!fs.existsSync(dir)) return '';
  const lc = email.toLowerCase();
  const allAnswers = [];
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        if (!s.participantEmails?.some(e => e.toLowerCase() === lc)) continue;
        for (const ans of (s.answers || [])) {
          if (ans.question && ans.answer) allAnswers.push({ ...ans, callDate: s.startedAt });
        }
      } catch (e) {}
    }
  } catch (e) { return ''; }
  if (!allAnswers.length) return '';
  allAnswers.sort((a, b) => {
    const s = (x) => x.feedback === 'up' ? 2 : x.feedback === 'down' ? 0 : 1;
    if (s(b) !== s(a)) return s(b) - s(a);
    return new Date(b.callDate) - new Date(a.callDate);
  });
  return allAnswers.slice(0, 4)
    .map(a => `Q: ${a.question.slice(0, 120)}\nA: ${a.answer.slice(0, 180)}`)
    .join('\n\n');
}

// ─── Chunk weights ─────────────────────────────────────────────────────────────
function weightsPath(projectId) {
  return path.join(PROJECTS_DIR, projectId, 'weights.json');
}

function loadWeights(projectId) {
  try {
    const p = weightsPath(projectId);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {}
  return {};
}

function saveWeights(projectId, weights) {
  fs.writeFileSync(weightsPath(projectId), JSON.stringify(weights, null, 2));
}

// ─── Load session docs ────────────────────────────────────────────────────────
async function loadSessionDocs(botId, projectId) {
  const session = sessions.get(botId);
  if (!session) return;
  session.docChunks = [];
  session.projectId = projectId;
  const manifest = loadManifest(projectId);
  const uploadsDir = path.join(PROJECTS_DIR, projectId, 'uploads');
  for (const entry of manifest) {
    const filePath = path.join(uploadsDir, entry.storedName);
    if (!fs.existsSync(filePath)) continue;
    try {
      const text = await extractText(filePath, '', entry.originalName);
      session.docChunks.push(...chunkText(text, entry.originalName));
    } catch (e) {
      console.error(`[docs] Failed to load ${entry.originalName}:`, e.message);
    }
  }
  if (!projectWeights[projectId]) projectWeights[projectId] = loadWeights(projectId);
  console.log(`[projects] Loaded "${projectId}" → session ${botId}: ${session.docChunks.length} chunks from ${manifest.length} docs`);
}

async function reloadProjectForSessions(projectId) {
  for (const session of sessions.values()) {
    if (session.projectId === projectId) {
      await loadSessionDocs(session.botId, projectId);
    }
  }
}

// ─── Live web search ───────────────────────────────────────────────────────────
async function liveWebSearch(question, quality = 'bestMatch') {
  const qualityInstructions = {
    bestMatch: '',
    credibleSources: 'Prioritize information from credible, authoritative sources such as official organizations, reputable news, and established institutions.',
    researchGrade: 'Provide comprehensive, well-sourced information from multiple authoritative sources. Cross-reference key facts.',
  };

  const systemPrompt = [
    'You are a real-time pitch assistant helping during a live business call.',
    'Use web search to find current, accurate information.',
    'Answer concisely in 2-3 sentences. Be direct with no preamble.',
    qualityInstructions[quality] || '',
  ].filter(Boolean).join(' ');

  const messages = [{ role: 'user', content: question }];
  const allSources = [];

  for (let turn = 0; turn < 5; turn++) {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages,
    });

    for (const block of resp.content) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) {
          if (r.url) allSources.push(r.url);
        }
      }
    }

    if (resp.stop_reason === 'end_turn') {
      const text = resp.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();
      return {
        answer: text || null,
        sources: [...new Set(allSources)].slice(0, 5),
        fromWeb: true,
        confidence: 'web',
      };
    }

    messages.push({ role: 'assistant', content: resp.content });
    messages.push({ role: 'user', content: [{ type: 'text', text: '' }] });
  }

  return { answer: null, sources: [...new Set(allSources)].slice(0, 5), fromWeb: true, confidence: 'web' };
}

// ─── RAG query ─────────────────────────────────────────────────────────────────
async function ragQuery(question, session) {
  const allChunks = [...(session?.docChunks || []), ...(session?.callDocChunks || [])];
  const qWords = question.toLowerCase().split(/\s+/);
  const weights = session?.projectId ? (projectWeights[session.projectId] || {}) : {};
  const scored = allChunks.map(chunk => {
    const text = chunk.text.toLowerCase();
    const rawScore = qWords.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
    const score = rawScore * (weights[chunk.id] ?? 1.0);
    return { ...chunk, score };
  }).sort((a, b) => b.score - a.score);

  const relevantChunks = scored.slice(0, 4).filter(c => c.score > 0);

  if (relevantChunks.length === 0) {
    if (webSearchCfg.live) {
      try {
        const webResult = await liveWebSearch(question, webSearchCfg.liveQuality || 'bestMatch');
        if (webResult.answer) return webResult;
      } catch (e) {
        console.error('[live-search] fallback error:', e.message);
      }
    }
    if (webSearchCfg.postCall && session) {
      session.zeroConfidenceLog.push({ question, ts: Date.now() });
    }
    return { answer: null, confidence: 'low' };
  }

  const callDocMatches = relevantChunks.filter(c => c.isCallDoc);
  const projDocMatches = relevantChunks.filter(c => !c.isCallDoc);

  const callDocContext = callDocMatches.length > 0
    ? 'CALL-SPECIFIC DOCUMENTS (highest priority — uploaded for this call):\n' +
      callDocMatches.map(c => `[${c.source}]\n${c.text}`).join('\n\n---\n\n')
    : '';

  const projDocContext = projDocMatches.length > 0
    ? 'PROJECT FOUNDATION DOCUMENTS (background reference):\n' +
      projDocMatches.map(c => `[${c.source}]\n${c.text}`).join('\n\n---\n\n')
    : '';

  const preCallSection = preCallCache.length > 0
    ? '\n\nPRE-CALL WEB RESEARCH:\n' + preCallCache
        .map(r => `Topic: ${r.question}\nAnswer: ${r.answer}`)
        .join('\n\n')
    : '';

  const recentTranscript = (session?.transcriptBuffer || []).slice(-8)
    .map(u => `${u.speaker}: ${u.text}`)
    .join('\n');

  const historySection = session?.callHistoryContext
    ? `\n\nPARTICIPANT HISTORY (lowest priority — historical reference only):\n${session.callHistoryContext}`
    : '';

  const systemPrompt = [
    'You are a real-time pitch assistant. A question has come up during a live call.',
    'Answer using ONLY the provided context. Be concise — this appears as an overlay. 2-3 sentences max.',
    'If context lacks enough info, say so briefly.',
    session?.brief
      ? `\nCALL BRIEF — HIGHEST PRIORITY:\n${session.brief}\n\nThe Call Brief above contains explicit instructions for this call. They take highest priority and override anything in the background documents if there is any conflict. Follow the Brief's tone, format, and positioning instructions exactly. Use the documents only to source factual information, but frame and present that information according to the Brief.`
      : '',
    session?.callHistoryContext
      ? 'This participant has been on previous calls. Treat prior history as lowest-priority context only — the Brief and call documents take precedence.'
      : '',
  ].filter(Boolean).join('\n');

  const docSections = [callDocContext, projDocContext].filter(Boolean).join('\n\n');

  const userPrompt = `RECENT CALL TRANSCRIPT:\n${recentTranscript}

QUESTION DETECTED:
${question}

${docSections}${preCallSection}${historySection}

ANSWER (2-3 sentences, direct, no preamble):`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return {
    answer: response.content[0].text,
    confidence: relevantChunks[0].score > 2 ? 'high' : 'medium',
    sources: [...new Set(relevantChunks.map(c => c.source))],
    chunkIds: relevantChunks.map(c => c.id).filter(Boolean),
  };
}

// ─── Question detection ────────────────────────────────────────────────────────
function isQuestion(text) {
  if (text.trim().endsWith('?')) return true;
  return /^(what|how|why|when|where|who|can you|could you|tell me|explain|do you|is there|are there|what's|what are|how does|how do)/i.test(text.trim());
}

// ─── Pre-call context preparation (Part 2) ────────────────────────────────────
async function prepareCallContext(brief) {
  preCallCache = [];
  if (!brief?.trim()) return { topics: [], count: 0 };

  let topics = [];
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Based on this call brief, identify 3-5 specific questions or topics likely to come up during the call. Return ONLY a valid JSON array of strings, no explanation.\n\nBrief:\n${brief}`,
      }],
    });
    const raw = (resp.content.find(b => b.type === 'text')?.text || '').trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned.match(/\[[\s\S]*\]/)?.[0] || '[]');
    topics = Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch (e) {
    console.error('[prepare] Topic inference failed:', e.message);
    return { topics: [], count: 0 };
  }

  const results = await Promise.all(
    topics.map(async (q) => {
      try {
        const r = await liveWebSearch(q, webSearchCfg.liveQuality || 'bestMatch');
        return r.answer ? { question: q, answer: r.answer, sources: r.sources } : null;
      } catch (e) {
        console.error(`[prepare] Search failed for "${q}":`, e.message);
        return null;
      }
    })
  );

  preCallCache = results.filter(Boolean);
  console.log(`[prepare] Cached ${preCallCache.length} pre-call results`);
  return { topics, count: preCallCache.length };
}

// ─── Post-call search (Part 3) ────────────────────────────────────────────────
async function runPostCallSearch(pendingLog) {
  const seen = new Set();
  const unique = pendingLog.filter(entry => {
    const key = entry.question.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);

  const results = await Promise.all(
    unique.map(async (entry, i) => {
      try {
        const r = await liveWebSearch(entry.question, webSearchCfg.liveQuality || 'bestMatch');
        if (!r.answer) return null;
        return {
          id: `psr_${Date.now()}_${i}_${crypto.randomBytes(3).toString('hex')}`,
          question: entry.question,
          answer: r.answer,
          sources: r.sources,
        };
      } catch (e) {
        console.error('[post-search] Search failed:', e.message);
        return null;
      }
    })
  );

  postSearchResults = results.filter(Boolean);
  console.log(`[post-search] Found ${postSearchResults.length} results`);
  return postSearchResults;
}

// ─── Multer: call-doc uploads (in-memory) ─────────────────────────────────────
const callUpload = multer({ storage: multer.memoryStorage() });

// ─── Competitor names from docs ────────────────────────────────────────────────
function loadCompetitorNames(projectId) {
  if (!projectId) return;
  const manifest = loadManifest(projectId);
  const competitorDocs = manifest.filter(m =>
    /competi/i.test(m.originalName)
  );
  const names = [];
  const uploadsDir = path.join(PROJECTS_DIR, projectId, 'uploads');
  for (const doc of competitorDocs) {
    try {
      const text = fs.readFileSync(path.join(uploadsDir, doc.storedName), 'utf-8');
      const matches = text.match(/\b[A-Z][a-z]{2,}\b/g) || [];
      names.push(...matches);
    } catch (e) {}
  }
  coaching.setCompetitorNames([...new Set(names)]);
}

// ─── Routes: Call docs ────────────────────────────────────────────────────────

app.get('/call/docs', (req, res) => {
  const session = getActiveSession();
  if (!session) return res.json({ sources: [], totalChunks: 0 });
  const sources = [...new Set(session.callDocChunks.map(c => c.source))];
  res.json({ sources, totalChunks: session.callDocChunks.length });
});

app.post('/call/docs/upload', callUpload.array('files'), async (req, res) => {
  const session = getActiveSession();
  if (!session) return res.status(400).json({ error: 'No active session' });
  const results = [];
  for (const file of req.files) {
    try {
      const text = await extractText(file.buffer, file.mimetype, file.originalname);
      const chunks = chunkText(text, file.originalname).map(c => ({ ...c, isCallDoc: true }));
      session.callDocChunks.push(...chunks);
      results.push({ name: file.originalname, chunks: chunks.length, status: 'ok' });
    } catch (e) {
      results.push({ name: file.originalname, status: 'error', error: e.message });
    }
  }
  res.json({ results, totalCallChunks: session.callDocChunks.length });
});

app.delete('/call/docs', (req, res) => {
  const session = getActiveSession();
  if (session) session.callDocChunks = [];
  res.json({ ok: true });
});

// ─── Routes: Projects ─────────────────────────────────────────────────────────

app.get('/projects', (req, res) => {
  res.json(loadProjects().projects);
});

app.post('/projects', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const data = loadProjects();
  const project = {
    id: `proj_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    name: name.trim(),
    createdAt: new Date().toISOString(),
  };
  data.projects.push(project);
  saveProjects(data);
  fs.mkdirSync(path.join(PROJECTS_DIR, project.id, 'uploads'), { recursive: true });
  res.json(project);
});

app.delete('/projects/:id', (req, res) => {
  const { id } = req.params;
  const data = loadProjects();
  data.projects = data.projects.filter(p => p.id !== id);
  saveProjects(data);
  const dir = path.join(PROJECTS_DIR, id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  for (const session of sessions.values()) {
    if (session.projectId === id) { session.docChunks = []; session.projectId = null; }
  }
  res.json({ ok: true });
});

// ─── Routes: Project docs ─────────────────────────────────────────────────────

app.get('/projects/:id/docs', (req, res) => {
  const id = req.params.id;
  const manifest = loadManifest(id);
  const files = manifest.map(entry => {
    const filePath = path.join(PROJECTS_DIR, id, 'uploads', entry.storedName);
    let size = entry.size || null;
    if (!size) {
      try { size = fs.statSync(filePath).size; } catch (e) {}
    }
    return { ...entry, size, filePath };
  });
  res.json({ files });
});

app.post('/projects/:id/docs/upload', projectUpload.array('files'), async (req, res) => {
  const { id } = req.params;
  const manifest = loadManifest(id);
  const results = [];
  for (const file of req.files) {
    try {
      const text = await extractText(file.path, file.mimetype, file.originalname);
      const chunks = chunkText(text, file.originalname);
      manifest.push({ storedName: file.filename, originalName: file.originalname, uploadedAt: new Date().toISOString(), chunks: chunks.length, size: file.size });
      results.push({ name: file.originalname, chunks: chunks.length, status: 'ok' });
    } catch (e) {
      results.push({ name: file.originalname, status: 'error', error: e.message });
    }
  }
  saveManifest(id, manifest);
  await reloadProjectForSessions(id);
  res.json({ results });
});

app.delete('/projects/:id/docs/:storedName', (req, res) => {
  const { id, storedName } = req.params;
  const manifest = loadManifest(id);
  const entry = manifest.find(m => m.storedName === storedName);
  if (!entry) return res.status(404).json({ error: 'not found' });
  const filePath = path.join(PROJECTS_DIR, id, 'uploads', storedName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  saveManifest(id, manifest.filter(m => m.storedName !== storedName));
  reloadProjectForSessions(id).catch(() => {});
  res.json({ ok: true });
});

// ─── Routes: Recall ────────────────────────────────────────────────────────────

app.post('/recall/webhook', async (req, res) => {
  res.sendStatus(200);
  const { event, data } = req.body;
  const botId = data?.bot_id;
  const session = botId ? sessions.get(botId) : getActiveSession();

  // bot.status_change — bot left or call ended
  if (event === 'bot.status_change') {
    const code = data?.data?.code || data?.code;
    if ((code === 'call_ended' || code === 'done' || code === 'fatal') && session) {
      webhookCallback?.('bot-left-call', { botId: session.botId });
    }
    return;
  }

  if (!session) return; // unknown session, ignore

  // participant.joined (old API) or participant_events.join / participant_events.update (new API)
  const isParticipantJoin = event === 'participant.joined' || event === 'participant_events.join' || event === 'participant_events.update';
  if (isParticipantJoin) {
    const participant = data?.data?.participant || data?.participant || {};
    const { id, name, email } = participant;
    if (id || name || email) {
      webhookCallback?.('participant-joined', {
        id:      id || email || name || 'unknown',
        name:    name || email || 'Guest',
        email:   email || '',
        gravatar: email ? gravatarUrl(email) : '',
      });
    }
    if (email && session.currentCallRecord) {
      const lc = email.toLowerCase();
      if (!session.currentCallRecord.participantEmails.includes(lc)) {
        session.currentCallRecord.participantEmails.push(lc);
        upsertCallRecord(session.currentCallRecord);
      }
      if (!session.callHistoryContext && session.projectId) {
        const hist = buildHistoryContext(session.projectId, lc);
        if (hist) {
          session.callHistoryContext = hist;
          console.log(`[history] Loaded context for ${lc}`);
        }
      }

      if (!session.suggestionMadeThisCall) {
        const suggestion = suggestProject(lc);
        if (suggestion && suggestion.projectId !== session.projectId) {
          session.previousProjectId = session.projectId;
          await loadSessionDocs(session.botId, suggestion.projectId);
          if (session.currentCallRecord) {
            session.currentCallRecord.projectId = suggestion.projectId;
            session.currentCallRecord.projectName = suggestion.projectName;
            upsertCallRecord(session.currentCallRecord);
          }
          session.suggestionMadeThisCall = true;
          webhookCallback?.('participant-suggestion', {
            projectId: suggestion.projectId,
            projectName: suggestion.projectName,
            previousProjectId: session.previousProjectId,
            email: lc,
          });
        }
      }
    }
  }

  // transcript events
  const isTranscript = event === 'transcript.data' || event === 'transcript.partial_data'
    || event === 'transcript.partial_update' || event === 'transcript.word';
  if (isTranscript) {
    const inner = data?.data || data;
    const utterance = {
      speaker: inner?.participant?.name || inner?.speaker || 'Unknown',
      text: (inner?.words || []).map(w => w.text).join(' ') || inner?.text || '',
      ts: Date.now(),
    };
    if (utterance.text.trim().length > 0) {
      session.transcriptBuffer.push(utterance);
      if (session.transcriptBuffer.length > BUFFER_SIZE) session.transcriptBuffer.shift();
      webhookCallback?.('transcript', utterance);
      coaching.onTranscriptEvent({ ...utterance, ts: Date.now() });
      engagement.onTranscriptEvent({ ...utterance, ts: Date.now() });
      if (isQuestion(utterance.text) && utterance.text.split(' ').length > 4) {
        const result = await ragQuery(utterance.text, session);
        if (result.answer) {
          const logEntry = {
            id: crypto.randomBytes(4).toString('hex'),
            question: utterance.text,
            answer: result.answer,
            chunkIds: result.chunkIds || [],
            feedback: null,
          };
          session.callAnswerLog.push(logEntry);
          webhookCallback?.('answer', {
            ...logEntry,
            confidence: result.confidence,
            sources: result.sources,
            fromWeb: result.fromWeb || false,
            speaker: utterance.speaker,
          });
        }
      }
    }
  }

  if (event === 'participant.left') {
    const participant = data?.data?.participant || data?.participant || {};
    const { id, name, email } = participant;
    const participantId = id || email || name || 'unknown';
    webhookCallback?.('participant-left', { id: participantId });

    // Detect if logged-in user left (skip for bot-only sessions)
    if (email && !session.botOnly) {
      const cfg = loadConfig();
      const userEmail = cfg.googleAuth?.email || '';
      if (userEmail && email.toLowerCase() === userEmail.toLowerCase()) {
        webhookCallback?.('user-left-call', { botId: session.botId });
      }
    }
  }
});

app.post('/recall/start', async (req, res) => {
  const { meeting_url, project_id, brief, bot_only } = req.body;
  if (!meeting_url) return res.status(400).json({ error: 'meeting_url required' });
  if (sessions.size >= 3) return res.status(429).json({ error: 'Max 3 concurrent sessions' });

  // Start coaching/engagement sessions
  coaching.startCoachingSession((nudge) => {
    webhookCallback?.('coaching-nudge', nudge);
  });
  engagement.startEngagementSession((scoreData) => {
    webhookCallback?.('engagement-score', scoreData);
  });
  loadCompetitorNames(project_id);

  try {
    const recallBase = process.env.RECALL_REGION
      ? `https://${process.env.RECALL_REGION}.recall.ai`
      : 'https://api.recall.ai';
    const response = await fetch(`${recallBase}/api/v1/bot/`, {
      method: 'POST',
      headers: { 'Authorization': `Token ${process.env.RECALL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meeting_url,
        bot_name: (() => {
          const cfg = loadConfig();
          if (cfg.botName) return cfg.botName;
          const first = (cfg.googleAuth?.name || '').trim().split(' ')[0];
          return first ? `${first}'s Notetaker` : 'Notetaker';
        })(),
        recording_config: {
          transcript: { provider: { recallai_streaming: {} } },
          realtime_endpoints: [{
            type: 'webhook',
            url: `${process.env.WEBHOOK_URL}/recall/webhook`,
            events: ['transcript.data', 'transcript.partial_data', 'participant_events.join', 'participant_events.update', 'bot.status_change'],
          }],
        },
      }),
    });
    const bot = await response.json();
    if (!response.ok || !bot.id) {
      const errMsg = bot.detail || bot.message || bot.error || JSON.stringify(bot);
      return res.status(502).json({ error: `Recall API: ${errMsg}` });
    }

    // Create session
    createSession(bot.id, {
      meetingUrl: meeting_url,
      projectId:  project_id || null,
      brief:      brief?.trim() || null,
      botOnly:    !!bot_only,
    });
    primaryBotId = bot.id;

    // Load project docs into session
    if (project_id) await loadSessionDocs(bot.id, project_id);

    // Create call record
    const session = sessions.get(bot.id);
    const proj = loadProjects().projects.find(p => p.id === project_id);
    session.currentCallRecord = {
      id: `call_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      projectId: project_id || null,
      projectName: proj?.name || null,
      participantEmails: [],
      startedAt: new Date().toISOString(),
    };
    upsertCallRecord(session.currentCallRecord);

    webhookCallback?.('session-started', { botId: bot.id, meetingUrl: meeting_url, botOnly: !!bot_only, projectId: project_id });
    res.json({ bot_id: bot.id, status: bot.status_changes?.[0]?.code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Part 2: Pre-call web research
app.post('/recall/prepare', async (req, res) => {
  const { brief } = req.body;
  if (!brief?.trim()) return res.status(400).json({ ok: false, error: 'brief required' });
  if (!webSearchCfg.preCall) return res.status(400).json({ ok: false, error: 'Pre-call web search is disabled in Settings' });
  try {
    const result = await prepareCallContext(brief);
    res.json({ ok: true, topics: result.topics, count: result.count });
  } catch (e) {
    console.error('[recall/prepare]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// End session — accepts optional bot_id, clears session state, triggers post-call search
app.post('/recall/end', async (req, res) => {
  const { bot_id } = req.body || {};
  const botId = bot_id || primaryBotId;
  const session = sessions.get(botId);
  if (!session) return res.json({ ok: true });

  const pendingLog = [...session.zeroConfidenceLog];

  // Save call summary before clearing state
  if (session.currentCallRecord && session.projectId && session.callAnswerLog.length > 0) {
    saveCallSummary(
      session.projectId,
      session.currentCallRecord.id,
      session.currentCallRecord.participantEmails || [],
      session.currentCallRecord.startedAt,
      [...session.callAnswerLog]
    );
  }

  coaching.endCoachingSession();
  engagement.endEngagementSession();
  endSessionState(botId);
  webhookCallback?.('session-ended', { botId });

  res.json({ ok: true, postSearchPending: webSearchCfg.postCall && pendingLog.length > 0 });

  // Part 3: run post-call search in background
  if (webSearchCfg.postCall && pendingLog.length > 0) {
    runPostCallSearch(pendingLog).then(() => {
      if (postSearchResults.length > 0) {
        webhookCallback?.('post-search-ready', { count: postSearchResults.length });
      }
    }).catch(e => console.error('[post-search] Error:', e.message));
  }
});

// ─── Routes: Project activate (mid-call switch) ───────────────────────────────

app.post('/project/activate', async (req, res) => {
  const { project_id } = req.body;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });
  const session = getActiveSession();
  if (!session) return res.status(400).json({ error: 'No active session' });
  await loadSessionDocs(session.botId, project_id);
  if (session.currentCallRecord) {
    const proj = loadProjects().projects.find(p => p.id === project_id);
    session.currentCallRecord.projectId = project_id;
    session.currentCallRecord.projectName = proj?.name || null;
    upsertCallRecord(session.currentCallRecord);
  }
  res.json({ ok: true, projectId: project_id });
});

// ─── Routes: Post-search review (Part 3) ──────────────────────────────────────

app.get('/postsearch/results', (req, res) => {
  res.json({ results: postSearchResults });
});

app.post('/postsearch/save', async (req, res) => {
  const { resultId, projectId } = req.body;
  if (!resultId || !projectId) return res.status(400).json({ error: 'resultId and projectId required' });

  const result = postSearchResults.find(r => r.id === resultId);
  if (!result) return res.status(404).json({ error: 'result not found' });

  const uploadsDir = path.join(PROJECTS_DIR, projectId, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const storedName = `web_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.txt`;
  const content = [
    `Question: ${result.question}`,
    '',
    `Answer: ${result.answer}`,
    '',
    result.sources.length ? `Sources:\n${result.sources.map(s => `  - ${s}`).join('\n')}` : '',
    '',
    `Saved: ${new Date().toISOString()}`,
  ].join('\n');
  fs.writeFileSync(path.join(uploadsDir, storedName), content, 'utf-8');

  const manifest = loadManifest(projectId);
  const originalName = `Web: ${result.question.slice(0, 60).replace(/[<>:"/\\|?*\n\r]/g, ' ').trim()}.txt`;
  manifest.push({ storedName, originalName, uploadedAt: new Date().toISOString(), chunks: 1 });
  saveManifest(projectId, manifest);

  await reloadProjectForSessions(projectId);

  postSearchResults = postSearchResults.filter(r => r.id !== resultId);
  res.json({ ok: true });
});

// ─── Routes: Feedback ─────────────────────────────────────────────────────────

app.post('/feedback', (req, res) => {
  const { chunkIds, vote } = req.body;
  const session = getActiveSession();
  if (!session?.projectId || !Array.isArray(chunkIds) || !chunkIds.length) {
    return res.json({ ok: false, reason: 'no active project or chunks' });
  }
  if (vote !== 'up' && vote !== 'down') {
    return res.status(400).json({ error: 'vote must be "up" or "down"' });
  }

  if (!projectWeights[session.projectId]) {
    projectWeights[session.projectId] = loadWeights(session.projectId);
  }
  const weights = projectWeights[session.projectId];

  for (const id of chunkIds) {
    const current = weights[id] ?? 1.0;
    weights[id] = vote === 'up'
      ? Math.min(current * 1.25, 3.0)
      : Math.max(current * 0.5, 0.1);
  }

  saveWeights(session.projectId, weights);

  const logEntry = session.callAnswerLog.find(e => e.chunkIds.some(id => chunkIds.includes(id)));
  if (logEntry) logEntry.feedback = vote;

  res.json({ ok: true });
});

// ─── Routes: Coaching config ──────────────────────────────────────────────────
app.post('/coaching/config', (req, res) => {
  coachingCfg = req.body || {};
  coaching.setCoachingConfig(coachingCfg);
  res.json({ ok: true });
});

// ─── Routes: Query & health ───────────────────────────────────────────────────

app.post('/query', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });
  const session = getActiveSession();
  const result = await ragQuery(question, session);
  res.json(result);
});

// ─── Google OAuth callback ─────────────────────────────────────────────────────
app.get('/oauth/callback', async (req, res) => {
  const { code, error } = req.query;
  console.log('[oauth] /oauth/callback hit — code present:', !!code, '| error:', error || 'none');

  if (error) {
    console.error('[oauth] Google returned error:', error);
    return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Sign-in failed</h2><p>' + error + '</p></body></html>');
  }
  if (!code) {
    console.error('[oauth] No code in callback — aborting');
    return res.status(400).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Missing code</h2></body></html>');
  }
  try {
    console.log('[oauth] Step 1: code received, starting token exchange…');
    const tokens = await exchangeGoogleCode(code);
    console.log('[oauth] Step 2: token exchange response received — access_token present:', !!tokens?.access_token);

    if (!tokens?.access_token) {
      console.error('[oauth] Step 2 FAILED: no access_token in response:', JSON.stringify(tokens));
      return res.status(500).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Token exchange failed</h2><p>' + (tokens?.error_description || tokens?.error || 'Check GOOGLE_CLIENT_SECRET in .env') + '</p></body></html>');
    }

    console.log('[oauth] Step 3: fetching Google profile…');
    const profile = await fetchGoogleProfile(tokens.access_token);
    console.log('[oauth] Step 3: profile fetched — name:', profile?.name || '(empty)', '| email:', profile?.email || '(empty)');

    console.log('[oauth] Step 4: saving tokens to config.json…');
    const config = loadConfig();
    config.googleAuth = {
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token || config.googleAuth?.refreshToken,
      expiresAt:    Date.now() + (tokens.expires_in || 3600) * 1000,
      ...profile,
    };
    saveConfig(config);
    console.log('[oauth] Step 4: tokens saved — expiresAt:', new Date(config.googleAuth.expiresAt).toISOString());

    console.log('[oauth] Step 5: calling oauthCompleteCallback — callback present:', !!oauthCompleteCallback);
    if (oauthCompleteCallback) oauthCompleteCallback(config.googleAuth);
    console.log('[oauth] Step 5: oauthCompleteCallback called, sending success page');

    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      body { font-family: -apple-system, sans-serif; text-align: center; padding: 60px; background: #0d1117; color: #e6edf3; }
      h2 { font-size: 20px; margin-bottom: 8px; }
      p  { color: #8b949e; font-size: 14px; }
    </style></head><body>
      <h2>Sign in successful</h2>
      <p>You can close this tab and return to Kalara.</p>
    </body></html>`);
  } catch (e) {
    console.error('[oauth] callback error:', e.message, e.stack);
    res.status(500).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Server error</h2><p>' + e.message + '</p></body></html>');
  }
});

app.get('/health', (req, res) => {
  const session = getActiveSession();
  res.json({
    status: 'ok',
    sessions: sessions.size,
    primaryBotId,
    activeProject: session?.projectId,
    foundationChunks: session?.docChunks.length || 0,
    callChunks: session?.callDocChunks.length || 0,
    transcriptBuffer: session?.transcriptBuffer.length || 0,
    webSearch: webSearchCfg,
    preCallCache: preCallCache.length,
    postSearchPending: postSearchResults.length,
  });
});

// ─── Server start ──────────────────────────────────────────────────────────────
let webhookCallback = null;

function setCoachingCfg(cfg) {
  coachingCfg = cfg;
  coaching.setCoachingConfig(cfg);
}

function setEngagementCfg(cfg) {
  engagement.setEngagementConfig(cfg);
}

function startWebhookServer(port, callback, onOAuthComplete) {
  webhookCallback = callback;
  oauthCompleteCallback = onOAuthComplete || null;
  setInterval(() => { coaching.tick(); engagement.tick(); }, 5000);
  app.listen(port, () => {
    console.log(`[server] Kalara server running on port ${port}`);
  });
}

function setWebSearchConfig(cfg) {
  webSearchCfg = cfg || {};
  console.log('[config] Web search config updated:', webSearchCfg);
}

module.exports = { startWebhookServer, setWebSearchConfig, setCoachingCfg, setEngagementCfg };
