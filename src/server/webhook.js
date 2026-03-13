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

// ─── OpenAI client ─────────────────────────────────────────────────────────────
const openai = new (require('openai'))({
  apiKey: process.env.OPENAI_API_KEY,
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
  let entries = [];
  try {
    if (fs.existsSync(manifestPath)) entries = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e) {}
  const uploadsDir = path.join(PROJECTS_DIR, projectId, 'uploads');
  const valid = entries.filter(entry => fs.existsSync(path.join(uploadsDir, entry.storedName)));
  if (valid.length !== entries.length) {
    console.log(`[manifest] Removed ${entries.length - valid.length} orphaned entries from project ${projectId}`);
    saveManifest(projectId, valid);
  }
  return valid;
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
const embeddingCache = new Map(); // projectId → [{ text, embedding, source }]


// ─── Session Manager ────────────────────────────────────────────────────────────
const sessions = new Map(); // Map<botId, SessionState>
let primaryBotId = null;

function createSession(botId, opts) {
  sessions.set(botId, {
    botId,
    meetingUrl:    opts.meetingUrl,
    meetingTitle:  opts.meetingTitle || null,
    calendarEventId: opts.calendarEventId || null,
    projectId:     opts.projectId || null,
    brief:         opts.brief || null,
    botOnly:       opts.botOnly || false,
    docChunks:       [],
    callDocChunks:   [],
    callAnswerLog:   [],
    zeroConfidenceLog: [],
    transcriptBuffer: [],
    fullTranscriptBuffer: [],
    speakerMap:           {},
    participantNamesByEmail: {},
    currentCallRecord: null,
    suggestionMadeThisCall: false,
    previousProjectId: null,
    callHistoryContext: '',
    historyContextLoaded: false,
    statusPollInterval: null,
    hasBeenRecording: false,
    hostSpeakerId: null,
  });
}

function getSession(botId) { return sessions.get(botId); }

function endSessionState(botId) {
  const session = sessions.get(botId);
  if (session?.statusPollInterval) clearInterval(session.statusPollInterval);
  sessions.delete(botId);
  if (primaryBotId === botId) primaryBotId = [...sessions.keys()].pop() || null;
}

function getActiveSession() { return primaryBotId ? sessions.get(primaryBotId) : null; }

// ─── Text extraction ───────────────────────────────────────────────────────────
const PDF_TIMEOUT_MS = 20000;

async function extractTextWithVision(source, originalName) {
  const data = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
  const base64 = data.toString('base64');
  console.log(`[vision] Extracting text from ${originalName} via GPT-4o PDF input`);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        {
          type: 'file',
          file: {
            filename: originalName,
            file_data: `data:application/pdf;base64,${base64}`,
          },
        },
        { type: 'text', text: 'Extract all text content from this PDF in order, preserving structure. Output only the extracted text.' },
      ],
    }],
    max_tokens: 4096,
  });

  const text = response.choices[0]?.message?.content || '';
  console.log(`[vision] Extracted ${text.length} chars from ${originalName}`);
  return text;
}

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
      console.log(`[vision] checking fallback: length=${d.text?.length}`);
      if (!d.text || d.text.length < 500) {
        console.log(`[vision] pdf-parse returned empty — falling back to GPT-4o Vision for ${originalName}`);
        return extractTextWithVision(source, originalName);
      }
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
    console.log(`[vision] checking fallback: length=${d.text?.length}`);
    if (!d.text || d.text.length < 500) {
      console.log(`[vision] pdf-parse returned empty — falling back to GPT-4o Vision for ${originalName}`);
      return extractTextWithVision(source, originalName);
    }
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

async function generateEmbeddings(chunks) {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: chunks.map(c => c.text),
  });
  return resp.data.map((item, i) => ({
    chunkIndex: i,
    text: chunks[i].text,
    embedding: item.embedding,
  }));
}

// ─── Call history ─────────────────────────────────────────────────────────────

function callHistoryDir(projectId) {
  return path.join(PROJECTS_DIR, projectId || 'unassigned', 'call-history');
}

function saveCallHistoryTranscript(snapshot) {
  const { callId, projectId, calendarEventId, meetingTitle, startedAt, endedAt,
          participantEmails, participantNamesByEmail, fullTranscriptBuffer } = snapshot;
  const dir = callHistoryDir(projectId);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${callId}.json`), JSON.stringify({
      callId, projectId: projectId || null, calendarEventId: calendarEventId || null,
      meetingTitle: meetingTitle || null, startedAt, endedAt,
      participantEmails: participantEmails || [],
      participantNamesByEmail: participantNamesByEmail || {},
      transcript: fullTranscriptBuffer || [],
    }, null, 2));
    console.log(`[history] Transcript saved: ${callId}.json`);
  } catch (e) {
    console.error('[history] Transcript save failed:', e.message);
  }
}

async function generateCallSummary(fullTranscriptBuffer) {
  const transcriptText = fullTranscriptBuffer.map(u => `${u.speaker}: ${u.text}`).join('\n');
  if (!transcriptText) return null;
  const prompt = `Summarize this call in 3-5 sentences covering: main topics discussed, key decisions made, action items, and any commitments or agreements. Be specific and factual.\n\nTRANSCRIPT:\n${transcriptText}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      });
      return msg.content[0]?.text || null;
    } catch (e) {
      console.warn(`[summary] Attempt ${attempt} failed: ${e.message}`);
      if (attempt === 2) return null;
    }
  }
}

function saveCallSummaryJson(snapshot, summaryText) {
  const { callId, projectId, calendarEventId, meetingTitle, startedAt, endedAt,
          participantEmails, participantNamesByEmail } = snapshot;
  const dir = callHistoryDir(projectId);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const proj = (loadProjects().projects || []).find(p => p.id === projectId);
    fs.writeFileSync(path.join(dir, `${callId}-summary.json`), JSON.stringify({
      callId, projectId: projectId || null, projectName: proj?.name || null,
      calendarEventId: calendarEventId || null, meetingTitle: meetingTitle || null,
      startedAt, endedAt,
      participantEmails: participantEmails || [],
      participantNamesByEmail: participantNamesByEmail || {},
      summaryText: summaryText ?? 'Summary generation failed -- full transcript available.',
      generatedAt: new Date().toISOString(),
    }, null, 2));
    console.log(`[summary] Summary saved: ${callId}-summary.json`);
  } catch (e) {
    console.error('[summary] Summary save failed:', e.message);
  }
}

async function updateProjectKnowledge(projectId, projectName, fullTranscriptBuffer) {
  if (!fullTranscriptBuffer?.length) return;
  const knowledgePath = path.join(PROJECTS_DIR, projectId, 'project-knowledge.md');
  let existing = '';
  try {
    if (fs.existsSync(knowledgePath)) existing = fs.readFileSync(knowledgePath, 'utf-8');
  } catch (e) { return; }
  const transcript = fullTranscriptBuffer.map(u => `${u.speaker}: ${u.text}`).join('\n');
  const resp = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: 'You update a project knowledge base. Extract NEW facts, decisions, people, or context from the transcript not already in the knowledge base. Focus on: names and roles, key decisions, action items, company/product details. If nothing is new, respond with exactly NO_NEW_FACTS. Otherwise respond with dated bullet points (- YYYY-MM-DD: ...) only.',
    messages: [{ role: 'user', content: `Existing knowledge base:\n${existing || '(empty)'}\n\nTranscript:\n${transcript}` }],
  });
  const text = (resp.content[0]?.text || '').trim();
  if (!text || text === 'NO_NEW_FACTS') return;
  fs.writeFileSync(knowledgePath, existing ? `${existing}\n\n${text}` : text, 'utf-8');
  console.log(`[knowledge] Updated project-knowledge.md for ${projectId}`);
}

function updateCallHistoryIndex(projectId, callId, entry) {
  const dir = callHistoryDir(projectId);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {
    console.error('[history] Index dir create failed:', e.message); return;
  }
  const indexPath = path.join(dir, 'call-history-index.json');
  let index = { calls: [] };
  if (fs.existsSync(indexPath)) {
    try { index = JSON.parse(fs.readFileSync(indexPath, 'utf-8')); } catch (e) {}
  }
  const idx = index.calls.findIndex(c => c.callId === callId);
  if (idx >= 0) index.calls[idx] = entry;
  else index.calls.unshift(entry);
  // Atomic write — prevents corruption from concurrent multi-session writes
  const tmpPath = indexPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2));
    fs.renameSync(tmpPath, indexPath);
  } catch (e) {
    console.error('[history] Index write failed:', e.message);
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

async function loadCrossProjectContext(participantEmails) {
  if (!participantEmails.length) return '';
  const lc = participantEmails.map(e => e.toLowerCase());
  let projectDirs = [];
  try {
    projectDirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
  } catch (e) { return ''; }

  const allProjects = loadProjects().projects || [];
  // Per-participant collection: email → matching summary entries
  const byParticipant = {};
  lc.forEach(e => { byParticipant[e] = []; });

  for (const projDir of projectDirs) {
    const indexPath = path.join(PROJECTS_DIR, projDir, 'call-history', 'call-history-index.json');
    if (!fs.existsSync(indexPath)) continue;
    let index;
    try { index = JSON.parse(fs.readFileSync(indexPath, 'utf-8')); } catch (e) { continue; }

    const proj = allProjects.find(p => p.id === projDir);
    const projectName = proj?.name || projDir;

    for (const entry of (index.calls || [])) {
      const entryEmails = (entry.participantEmails || []).map(e => e.toLowerCase());
      const matchingParticipants = lc.filter(e => entryEmails.includes(e));
      if (!matchingParticipants.length) continue;

      const summaryPath = path.join(PROJECTS_DIR, projDir, 'call-history', `${entry.callId}-summary.json`);
      if (!fs.existsSync(summaryPath)) continue;

      let summaryText;
      try {
        const s = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
        summaryText = s.summaryText;
      } catch (e) { continue; }

      const summaryEntry = { callId: entry.callId, date: entry.date, projectName,
        participants: entry.participantNames || entry.participantEmails || [], summaryText };
      for (const email of matchingParticipants) {
        byParticipant[email].push(summaryEntry);
      }
    }
  }

  // Per participant: 3 most recent; deduplicate across participants by callId
  const seenCallIds = new Set();
  const finalEntries = [];
  for (const email of lc) {
    const sorted = (byParticipant[email] || []).sort((a, b) => new Date(b.date) - new Date(a.date));
    for (const entry of sorted.slice(0, 4)) {
      if (seenCallIds.has(entry.callId)) continue;
      seenCallIds.add(entry.callId);
      finalEntries.push(entry);
    }
  }
  if (!finalEntries.length) return '';

  // TODO: Monitor token cost of history context injection in production.
  // Currently uncapped across participants -- consider capping at N summaries or X tokens
  // once real usage data exists. Each summary is ~500-1000 tokens; at scale this
  // could meaningfully increase per-query input costs.
  return finalEntries.map(e => {
    const date = e.date
      ? new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'Unknown date';
    const names = Array.isArray(e.participants) ? e.participants.join(', ') : (e.participants || 'unknown participants');
    return `PAST CALL CONTEXT: From ${e.projectName} / ${date} with ${names}:\n${e.summaryText}`;
  }).join('\n\n');
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
    'Answer in 2-3 sentences maximum. Start with the answer immediately — never use preamble like \'I\'ll search\' or \'Based on my search\'. Never use bullet points or numbered lists. Be direct and specific.',
    qualityInstructions[quality] || '',
  ].filter(Boolean).join(' ');

  const messages = [{ role: 'user', content: question }];
  const allSources = [];

  for (let turn = 0; turn < 5; turn++) {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: systemPrompt,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      tool_choice: { type: 'auto' },
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
  console.log(`[rag] chunks available: ${allChunks.length} projectId=${session?.projectId || 'none'}`);
  const qWords = question.toLowerCase().split(/\s+/);
  const weights = session?.projectId ? (projectWeights[session.projectId] || {}) : {};
  const scored = allChunks.map(chunk => {
    const text = chunk.text.toLowerCase();
    const rawScore = qWords.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
    const score = rawScore * (weights[chunk.id] ?? 1.0);
    return { ...chunk, score };
  }).sort((a, b) => b.score - a.score);

  let relevantChunks = scored.slice(0, 4).filter(c => c.score > 0);

  if (relevantChunks.length === 0 && allChunks.length > 0) {
    // Semantic fallback: ask Haiku to find relevant chunks by meaning, not keywords
    console.log('[rag] keyword scoring empty — trying semantic fallback');
    try {
      const candidateChunks = allChunks.slice(0, 20);
      const chunkList = candidateChunks
        .map((c, i) => `[${i}] ${c.text.slice(0, 300)}`)
        .join('\n\n');
      const semResp = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{ role: 'user', content: `Question: ${question}\n\nDocument chunks:\n${chunkList}\n\nWhich chunk indices (0-based) are most relevant for answering this question? Return ONLY a JSON array of indices, e.g. [0, 3]. Return [] if none are relevant.` }],
      });
      const raw = (semResp.content[0]?.text || '').trim();
      const indices = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] || '[]');
      if (Array.isArray(indices) && indices.length > 0) {
        relevantChunks = indices
          .filter(i => typeof i === 'number' && i >= 0 && i < candidateChunks.length)
          .slice(0, 4)
          .map(i => ({ ...candidateChunks[i], score: 1 }));
      }
    } catch (e) {
      console.error('[rag] semantic fallback error:', e.message);
    }
  }

  if (relevantChunks.length === 0) {
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

  // Lazy cross-project context loading: run once per session, re-run when new participants join
  if (session && !session.historyContextLoaded) {
    const emails = session.currentCallRecord?.participantEmails || [];
    if (emails.length > 0) {
      try {
        session.callHistoryContext = await loadCrossProjectContext(emails);
        if (session.callHistoryContext) console.log('[history] Cross-project context loaded');
      } catch (e) {
        console.error('[history] Context load error:', e.message);
      }
    }
    session.historyContextLoaded = true;
  }

  const historySection = session?.callHistoryContext
    ? `\n\n${session.callHistoryContext}`
    : '';

  const systemPrompt = [
    'You are a real-time pitch assistant. A question has come up during a live call.',
    'Answer using ONLY the provided context.',
    'Never begin your response with phrases like "Based on the documents", "According to the context", "From the provided context", or any similar preamble. Answer directly and immediately. Every word must earn its place.',
    'Your response MUST contain exactly two sections separated by the string ---EXPAND--- on its own line.',
    'SECTION 1 (compact): Displayed on a tiny floating overlay during a live call. Two display sizes exist — small (shows 3 lines) and large (shows 4 lines). Always write exactly 4 lines: Line 1: a 3-5 word framing phrase ending in a colon. Lines 2-3: the 2 most critical concrete facts — numbers, names, key terms — each under 10 words. These must be the most essential points, shown in both small and large mode. Line 4 (only visible in large mode): a single punchy conclusion or so-what statement under 10 words — only visible in large mode. No explanation, no filler.',
    'SECTION 2 (expanded): 3-5 additional lines written as natural spoken talking points — things you would actually say out loud to an investor. Conversational but precise. No jargon, no passive voice, no corporate language. Use line breaks between distinct points.',
    'Format exactly as:\n[compact answer]\n---EXPAND---\n[expanded answer]',
    'If the provided context does not contain enough information to answer the question confidently and specifically, respond with exactly the word SKIP and nothing else.',
    session?.brief
      ? `\nCALL BRIEF — HIGHEST PRIORITY:\n${session.brief}\n\nThe Call Brief above contains explicit instructions for this call. They take highest priority and override anything in the background documents if there is any conflict. Follow the Brief's tone, format, and positioning instructions exactly. Use the documents only to source factual information, but frame and present that information according to the Brief.`
      : '',
    session?.callHistoryContext
      ? 'If a question or topic was discussed in a past call listed in PAST CALL CONTEXT, reference it explicitly in your answer with the date and participants. Example: As discussed on Dec 7 with Rick and Amy, we agreed that... Treat past call context as lowest priority — the Brief and call documents take precedence.'
      : '',
  ].filter(Boolean).join('\n');

  const docSections = [callDocContext, projDocContext].filter(Boolean).join('\n\n');

  const userPrompt = `RECENT CALL TRANSCRIPT:\n${recentTranscript}

QUESTION DETECTED:
${question}

${docSections}${preCallSection}${historySection}

RESPONSE:`;

  const ragModel = loadConfig().ragModel || 'claude-haiku-4-5-20251001';
  console.log('[rag] Using model:', ragModel);
  const response = await anthropic.messages.create({
    model: ragModel,
    max_tokens: 600,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const answerText = response.content[0].text.trim();
  if (answerText === 'SKIP') return { answer: null, confidence: 'low' };

  const expandIdx = answerText.indexOf('---EXPAND---');
  const compact  = expandIdx >= 0 ? answerText.slice(0, expandIdx).trim() : answerText;
  const expanded = expandIdx >= 0 ? answerText.slice(expandIdx + 12).trim() : null;

  return {
    answer: compact,
    expandedAnswer: expanded,
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
  if (!req.files || req.files.length === 0) return res.json({ queued: [] });

  // Add all files to manifest immediately with status: 'processing' so they appear in the UI
  const manifest = loadManifest(id);
  for (const file of req.files) {
    manifest.push({ storedName: file.filename, originalName: file.originalname, uploadedAt: new Date().toISOString(), size: file.size, status: 'processing' });
  }
  saveManifest(id, manifest);

  // Respond immediately
  res.json({ queued: req.files.map(f => f.originalname) });

  // Extraction and embedding run in the background
  (async () => {
    for (const file of req.files) {
      try {
        const text = await extractText(file.path, file.mimetype, file.originalname);
        try { fs.writeFileSync(file.path + '.extracted.txt', text, 'utf-8'); } catch (e) {}
        const chunks = chunkText(text, file.originalname);
        generateEmbeddings(chunks).then(embeddings => {
          try {
            fs.writeFileSync(file.path + '.embeddings.json', JSON.stringify(embeddings), 'utf-8');
            console.log(`[embeddings] Generated embeddings for ${file.originalname}`);
          } catch (e) {
            console.error(`[embeddings] Failed to save embeddings for ${file.originalname}:`, e.message);
          }
        }).catch(e => {
          console.error(`[embeddings] Failed to generate embeddings for ${file.originalname}:`, e.message);
        });
        // Update manifest entry in-place: set chunk count, clear processing status
        const current = loadManifest(id);
        const entry = current.find(m => m.storedName === file.filename);
        if (entry) { entry.chunks = chunks.length; delete entry.status; saveManifest(id, current); }
        await reloadProjectForSessions(id);
        embeddingCache.delete(id);
        webhookCallback?.('doc-ingested', { name: file.originalname, projectId: id });
      } catch (e) {
        console.error(`[upload] Failed to process ${file.originalname}:`, e.message);
      }
    }
  })().catch(e => console.error('[upload] Background processing error:', e.message));
});

app.delete('/projects/:id/docs/:storedName', (req, res) => {
  const { id, storedName } = req.params;
  const manifest = loadManifest(id);
  const entry = manifest.find(m => m.storedName === storedName);
  if (!entry) return res.status(404).json({ error: 'not found' });
  const filePath = path.join(PROJECTS_DIR, id, 'uploads', storedName);
  for (const p of [filePath, filePath + '.extracted.txt', filePath + '.embeddings.json']) {
    try { fs.unlinkSync(p); } catch (e) { if (e.code !== 'ENOENT') console.error(`[delete] Failed to remove ${p}:`, e.message); }
  }
  saveManifest(id, manifest.filter(m => m.storedName !== storedName));
  embeddingCache.delete(id);
  reloadProjectForSessions(id).catch(() => {});
  res.json({ ok: true });
});

app.post('/project/suggest', (req, res) => {
  const { emails } = req.body;
  if (!Array.isArray(emails) || emails.length === 0) return res.json({ projectId: null, projectName: null });
  const counts = {};
  for (const email of emails) {
    const s = suggestProject(email);
    if (s) counts[s.projectId] = (counts[s.projectId] || 0) + 1;
  }
  const entries = Object.entries(counts);
  if (!entries.length) return res.json({ projectId: null, projectName: null });
  const [bestId] = entries.sort(([, a], [, b]) => b - a)[0];
  const project = loadProjects().projects.find(p => p.id === bestId);
  if (!project) return res.json({ projectId: null, projectName: null });
  res.json({ projectId: bestId, projectName: project.name });
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
      webhookCallback?.('bot-left-call', { botId: session.botId, transcriptCount: session.fullTranscriptBuffer.length });
    }
    return;
  }

  if (!session) return; // unknown session, ignore

  // participant.joined (old API) or participant_events.join / participant_events.update (new API)
  const isParticipantJoin = event === 'participant.joined' || event === 'participant_events.join' || event === 'participant_events.update';
  if (isParticipantJoin) {
    const participant = data?.data?.participant || data?.participant || {};
    const { id, name, email } = participant;
    // Identify host speaker
    if (id && email && email.toLowerCase() === (loadConfig().googleEmail || '').toLowerCase()) {
      session.hostSpeakerId = id;
    }
    // Build speakerMap: prefer real name, fall back to email local-part
    if (id) {
      if (name && !/^Speaker\s+\d+$/i.test(name)) {
        session.speakerMap[id] = name;
      } else if (email) {
        session.speakerMap[id] = email.split('@')[0];
      }
    }
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
      const displayName = name && !/^Speaker\s+\d+$/i.test(name) ? name : (email.split('@')[0]);
      if (!session.currentCallRecord.participantEmails.includes(lc)) {
        session.currentCallRecord.participantEmails.push(lc);
        upsertCallRecord(session.currentCallRecord);
        // Map email to display name; invalidate context cache so next RAG query re-loads
        session.participantNamesByEmail[lc] = displayName;
        session.historyContextLoaded = false;
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
    const participantId = inner?.participant?.id;
    const rawLabel = inner?.participant?.name || inner?.speaker || '';
    const genericMatch = rawLabel.match(/^Speaker\s+(\d+)$/i);
    const resolvedName = (participantId && session.speakerMap[participantId])
      || (rawLabel && !genericMatch ? rawLabel : null)
      || (genericMatch ? `Unknown Speaker ${genericMatch[1]}` : 'Unknown');
    const utterance = {
      speaker: resolvedName,
      speakerId: participantId,
      text: (inner?.words || []).map(w => w.text).join(' ') || inner?.text || '',
      ts: Date.now(),
    };
    if (utterance.text.trim().length > 0) {
      session.transcriptBuffer.push(utterance);
      if (session.transcriptBuffer.length > BUFFER_SIZE) session.transcriptBuffer.shift();
      session.fullTranscriptBuffer.push(utterance);
      webhookCallback?.('transcript', utterance);
      coaching.onTranscriptEvent({ ...utterance, ts: Date.now() });
      engagement.onTranscriptEvent({ ...utterance, ts: Date.now() });
      const isHostUtterance = loadConfig().ignoreHostSpeaker === true && session.hostSpeakerId !== null && utterance.speakerId === session.hostSpeakerId;
      if (!isHostUtterance && event === 'transcript.data' && isQuestion(utterance.text) && utterance.text.split(' ').length > 4 && Date.now() - (session.lastRagAt || 0) >= 8000) {
        session.lastRagAt = Date.now();
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
            expandedAnswer: result.expandedAnswer || null,
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
  console.log('[recall] Starting session — creating bot...');
  const { meeting_url, project_id, brief, bot_only, meeting_title, organizer_email, calendar_event_id } = req.body;
  if (!meeting_url) return res.status(400).json({ error: 'meeting_url required' });

  // Reuse existing session if one is already active for this meeting URL
  for (const [botId, session] of sessions) {
    if (session.meetingUrl === meeting_url) {
      console.log('[recall] Reusing existing session for meeting URL — botId:', botId);
      return res.json({ bot_id: botId, call_id: session.currentCallRecord?.id, reused: true });
    }
  }

  if (sessions.size >= 3) return res.status(429).json({ error: 'Max 3 concurrent sessions' });

  // Resolve project: explicit > organizer email heuristic > null (mid-call auto-detect)
  let resolvedProjectId = project_id || null;
  if (!resolvedProjectId && organizer_email) {
    const suggestion = suggestProject(organizer_email);
    if (suggestion) {
      resolvedProjectId = suggestion.projectId;
      console.log(`[auto-join] Organizer ${organizer_email} → project "${suggestion.projectName}"`);
    } else {
      console.log(`[auto-join] Organizer ${organizer_email} → no project match (mid-call detection will run)`);
    }
  }

  // Start coaching/engagement sessions
  coaching.startCoachingSession((nudge) => {
    webhookCallback?.('coaching-nudge', nudge);
  });
  engagement.startEngagementSession((scoreData) => {
    webhookCallback?.('engagement-score', scoreData);
  });
  loadCompetitorNames(resolvedProjectId);

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
            events: ['transcript.data', 'transcript.partial_data', 'participant_events.join', 'participant_events.update'],
          }],
        },
        automatic_leave: {
          everyone_left_timeout: 5,
        },
      }),
    });
    const bot = await response.json();
    if (!response.ok || !bot.id) {
      const errMsg = bot.detail || bot.message || bot.error || JSON.stringify(bot);
      return res.status(502).json({ error: `Recall API: ${errMsg}` });
    }
    console.log('[recall] Bot created:', bot.id);

    // Generate a unique call ID for this session
    const callId = crypto.randomUUID();

    // Create session
    createSession(bot.id, {
      meetingUrl:      meeting_url,
      meetingTitle:    meeting_title?.trim() || null,
      calendarEventId: calendar_event_id?.trim() || null,
      projectId:       resolvedProjectId,
      brief:           brief?.trim() || null,
      botOnly:         !!bot_only,
    });
    primaryBotId = bot.id;

    // Load project docs into session
    if (resolvedProjectId) await loadSessionDocs(bot.id, resolvedProjectId);

    // Create call record using the generated callId
    const session = sessions.get(bot.id);
    const proj = loadProjects().projects.find(p => p.id === resolvedProjectId);
    session.currentCallRecord = {
      id: callId,
      projectId: resolvedProjectId,
      projectName: proj?.name || null,
      participantEmails: [],
      startedAt: new Date().toISOString(),
    };
    upsertCallRecord(session.currentCallRecord);

    // Poll bot status every 10s to detect call end without relying on bot.status_change webhook
    const recallBaseForPoll = process.env.RECALL_REGION
      ? `https://${process.env.RECALL_REGION}.recall.ai`
      : 'https://api.recall.ai';
    session.statusPollInterval = setInterval(async () => {
      const currentSession = sessions.get(bot.id);
      if (!currentSession) { clearInterval(session.statusPollInterval); return; }
      try {
        const pollRes = await fetch(`${recallBaseForPoll}/api/v1/bot/${bot.id}/`, {
          headers: { 'Authorization': `Token ${process.env.RECALL_API_KEY}` },
        });
        if (!pollRes.ok) return;
        const pollData = await pollRes.json();
        const code = pollData.status_changes?.[pollData.status_changes.length - 1]?.code || pollData.status?.code;
        console.log('[recall] Poll tick — botId:', bot.id, 'status:', code);
        if (code === 'in_call_recording') currentSession.hasBeenRecording = true;
        if (code === 'done' || code === 'call_ended' || code === 'fatal' || (code === 'in_call_not_recording' && currentSession.hasBeenRecording)) {
          clearInterval(currentSession.statusPollInterval);
          currentSession.statusPollInterval = null;
          webhookCallback?.('bot-left-call', { botId: bot.id, transcriptCount: currentSession.fullTranscriptBuffer?.length || 0 });
        }
      } catch (e) {
        // Network error — keep polling
      }
    }, 10000);

    webhookCallback?.('session-started', {
      botId: bot.id, meetingUrl: meeting_url, meetingTitle: meeting_title?.trim() || null,
      botOnly: !!bot_only, projectId: resolvedProjectId, callId,
    });
    res.json({ bot_id: bot.id, status: bot.status_changes?.[0]?.code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Test session — creates a real session without calling the Recall.ai API
app.post('/recall/start-test', async (req, res) => {
  const { meeting_url, project_id, brief, bot_only, meeting_title } = req.body;
  if (!meeting_url) return res.status(400).json({ error: 'meeting_url required' });
  if (sessions.size >= 3) return res.status(429).json({ error: 'Max 3 concurrent sessions' });

  const resolvedProjectId = project_id || null;

  coaching.startCoachingSession((nudge) => {
    webhookCallback?.('coaching-nudge', nudge);
  });
  engagement.startEngagementSession((scoreData) => {
    webhookCallback?.('engagement-score', scoreData);
  });
  loadCompetitorNames(resolvedProjectId);

  const botId = crypto.randomUUID();
  const callId = crypto.randomUUID();

  createSession(botId, {
    meetingUrl:   meeting_url,
    meetingTitle: meeting_title?.trim() || null,
    projectId:    resolvedProjectId,
    brief:        brief?.trim() || null,
    botOnly:      !!bot_only,
  });
  primaryBotId = botId;

  if (resolvedProjectId) await loadSessionDocs(botId, resolvedProjectId);

  const session = sessions.get(botId);
  const proj = loadProjects().projects.find(p => p.id === resolvedProjectId);
  session.currentCallRecord = {
    id: callId,
    projectId: resolvedProjectId,
    projectName: proj?.name || null,
    participantEmails: [],
    startedAt: new Date().toISOString(),
  };
  upsertCallRecord(session.currentCallRecord);

  webhookCallback?.('session-started', {
    botId, meetingUrl: meeting_url, meetingTitle: meeting_title?.trim() || null,
    botOnly: !!bot_only, projectId: resolvedProjectId, callId,
  });

  res.json({ bot_id: botId, call_id: callId, status: 'test_session' });
});

// Test-only: trigger meeting alert with hardcoded data (sends to main via webhookCallback)
app.post('/recall/test-meeting-alert', (req, res) => {
  res.sendStatus(200);
  const startTime = new Date(Date.now() + 8 * 60 * 1000);
  const meeting = {
    title: 'Series A Prep — Sequoia Capital',
    startIso: startTime.toISOString(),
    endIso: new Date(startTime.getTime() + 60 * 60 * 1000).toISOString(),
    meetLink: 'https://meet.google.com/test-meeting',
    organizer: { name: 'Sarah Chen', email: 'sarah@sequoia.com' },
  };
  webhookCallback?.('meeting-alert-data', meeting);
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

  // Snapshot all data before clearing session state
  const endedAt = new Date().toISOString();
  const snapshot = {
    callId:      session.currentCallRecord?.id,
    projectId:   session.projectId,
    calendarEventId: session.calendarEventId,
    meetingTitle: session.meetingTitle,
    startedAt:   session.currentCallRecord?.startedAt,
    endedAt,
    participantEmails:       [...(session.currentCallRecord?.participantEmails || [])],
    participantNamesByEmail: { ...session.participantNamesByEmail },
    fullTranscriptBuffer:    [...session.fullTranscriptBuffer],
  };

  coaching.endCoachingSession();
  engagement.endEngagementSession();
  endSessionState(botId);
  webhookCallback?.('session-ended', { botId });

  res.json({ ok: true, postSearchPending: webSearchCfg.postCall && pendingLog.length > 0 });

  // Post-call save: transcript JSON + AI summary + index update (background, after response)
  if (snapshot.callId) {
    (async () => {
      // 1. Always save full transcript JSON
      saveCallHistoryTranscript(snapshot);

      // 2. AI summary only if transcript has >= 10 utterances
      if (snapshot.fullTranscriptBuffer.length >= 10) {
        const summaryText = await generateCallSummary(snapshot.fullTranscriptBuffer);
        saveCallSummaryJson(snapshot, summaryText);
        const projName = (loadProjects().projects || []).find(p => p.id === snapshot.projectId)?.name || null;
        updateProjectKnowledge(snapshot.projectId, projName, snapshot.fullTranscriptBuffer)
          .catch(e => console.error('[knowledge]', e.message));
        const participantNames = Object.values(snapshot.participantNamesByEmail);
        updateCallHistoryIndex(snapshot.projectId, snapshot.callId, {
          callId: snapshot.callId, date: snapshot.startedAt,
          meetingTitle: snapshot.meetingTitle || null,
          participantEmails: snapshot.participantEmails, participantNames,
          summaryExcerpt: summaryText ? summaryText.slice(0, 200) : null,
        });
      } else {
        console.log(`[summary] Skipped — transcript has ${snapshot.fullTranscriptBuffer.length} utterances (min 10)`);
        // Still index the call for participant tracking (no summaryExcerpt)
        updateCallHistoryIndex(snapshot.projectId, snapshot.callId, {
          callId: snapshot.callId, date: snapshot.startedAt,
          meetingTitle: snapshot.meetingTitle || null,
          participantEmails: snapshot.participantEmails,
          participantNames: Object.values(snapshot.participantNamesByEmail),
          summaryExcerpt: null,
        });
      }
    })().catch(e => console.error('[history] Post-call save error:', e.message));
  }

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

// ─── Routes: Summary status (for bot-left toast polling) ──────────────────────

app.get('/session/summary-status/:callId', (req, res) => {
  const { callId } = req.params;
  let projectId = null;
  try {
    const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
    for (const dir of dirs) {
      if (fs.existsSync(path.join(PROJECTS_DIR, dir, 'call-history', `${callId}-summary.json`))) {
        projectId = dir; break;
      }
    }
  } catch (e) {}
  res.json({ ready: !!projectId, projectId });
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
  const { question, context, manualProjectId } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });

  const session = getActiveSession();
  const projectId = session?.projectId || manualProjectId || null;

  if (!projectId) {
    return res.json({ answer: 'Please select a project first.', sources: [], followUps: [] });
  }

  const questionEmbeddingPromise = openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: [question],
  });

  let _t = Date.now();
  console.log(`[query] start — project=${projectId} session=${!!session}`);

  // ── Build context sections ──────────────────────────────────────────────────
  const contextSections = [];

  // 1. Brief
  if (session?.brief) {
    contextSections.push(`CALL BRIEF — HIGHEST PRIORITY INSTRUCTIONS:\n${session.brief}`);
  }

  // 2. Pre-call research
  if (preCallCache.length) {
    const preCallText = preCallCache.map(e => `Topic: ${e.question}\n${e.answer}`).join('\n\n');
    contextSections.push(`PRE-CALL RESEARCH:\n${preCallText}`);
  }

  // 3. Past call summaries
  if (session && session.currentCallRecord?.participantEmails?.length) {
    try {
      const historyCtx = await loadCrossProjectContext(session.currentCallRecord.participantEmails);
      if (historyCtx) contextSections.push(historyCtx);
    } catch (e) {
      console.error('[query] cross-project context error:', e.message);
    }
  } else if (!session && manualProjectId) {
    try {
      const indexPath = path.join(PROJECTS_DIR, manualProjectId, 'call-history', 'call-history-index.json');
      if (fs.existsSync(indexPath)) {
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        const sorted = (index.calls || []).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4);
        const summaryBlocks = [];
        for (const entry of sorted) {
          const summaryPath = path.join(PROJECTS_DIR, manualProjectId, 'call-history', `${entry.callId}-summary.json`);
          if (!fs.existsSync(summaryPath)) continue;
          try {
            const s = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
            const date = entry.date
              ? new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : 'Unknown date';
            const names = Array.isArray(entry.participantNames) ? entry.participantNames.join(', ') : (entry.participantEmails || []).join(', ');
            summaryBlocks.push(`${date} with ${names}:\n${s.summaryText}`);
          } catch (e) {}
        }
        if (summaryBlocks.length) contextSections.push(`PAST CALL SUMMARIES:\n${summaryBlocks.join('\n\n')}`);
      }
    } catch (e) {
      console.error('[query] manual project history error:', e.message);
    }
  }

  // 4. Live transcript
  if (session?.fullTranscriptBuffer?.length) {
    const transcriptLines = session.fullTranscriptBuffer.map(u => `${u.speaker}: ${u.text}`).join('\n');
    contextSections.push(`LIVE CALL TRANSCRIPT:\n${transcriptLines}`);
  }

  // 5. Project documents (embedding-based retrieval)
  try {
    let projectEmbeddings = embeddingCache.get(projectId) || null;
    if (!projectEmbeddings) {
      const manifest = loadManifest(projectId);
      const uploadsDir = path.join(PROJECTS_DIR, projectId, 'uploads');
      const allChunks = [];
      for (const entry of manifest) {
        const embeddingsPath = path.join(uploadsDir, entry.storedName + '.embeddings.json');
        if (!fs.existsSync(embeddingsPath)) continue;
        try {
          const raw = JSON.parse(fs.readFileSync(embeddingsPath, 'utf-8'));
          for (const item of raw) {
            allChunks.push({ text: item.text, embedding: item.embedding, source: entry.originalName });
          }
        } catch (e) {}
      }
      projectEmbeddings = allChunks;
      embeddingCache.set(projectId, projectEmbeddings);
    }

    if (projectEmbeddings.length) {
      const qResp = await questionEmbeddingPromise;
      const qVec = qResp.data[0].embedding;

      function cosineSim(a, b) {
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
      }

      const topChunks = projectEmbeddings
        .map(chunk => ({ ...chunk, score: cosineSim(qVec, chunk.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      if (topChunks.length) {
        contextSections.push(`PROJECT DOCUMENTS:\n${topChunks.map(c => `[${c.source}]\n${c.text}`).join('\n\n')}`);
      }
    }
  } catch (e) {
    console.error('[query] embedding retrieval error:', e.message);
  }

  // 6. Project knowledge base
  try {
    const knowledgePath = path.join(PROJECTS_DIR, projectId, 'project-knowledge.md');
    if (fs.existsSync(knowledgePath)) {
      const kb = fs.readFileSync(knowledgePath, 'utf-8').trim();
      if (kb) contextSections.push(`PROJECT KNOWLEDGE BASE:\n${kb}`);
    }
  } catch (e) {}

  const fullContext = contextSections.join('\n\n---\n\n');
  console.log(`[query] context built — ${fullContext.length} chars (+${Date.now() - _t}ms)`); _t = Date.now();

  // ── System prompt ───────────────────────────────────────────────────────────
  const systemPrompt = 'You are a real-time call assistant answering questions during a live call. Answer directly without preamble or introduction. 2-3 sentences maximum unless more detail is genuinely needed. Never reference \'the documents\' or \'the context\'. The call brief, if present, takes highest priority — follow its tone, framing, and positioning instructions above everything else. When questions are about specific participants, use the transcript to answer. If the context is insufficient to answer accurately, say so clearly rather than speculating. Format answers as short bullet points when there are multiple points to make. Each bullet should be one concise line — a speaking point, not a paragraph. Never use markdown bold (no asterisks). 3-5 bullets maximum. If the answer is a single fact, one sentence is fine.';

  // ── Effective question (follow-up context injection) ────────────────────────
  const effectiveQuestion = context?.previousAnswer
    ? `Give a direct 2-3 sentence answer only. Do not re-explain background the user already knows.\n\nThe user already knows: ${context.previousAnswer}\n\nNow answer only this follow-up directly, treating the above as assumed knowledge: ${question}`
    : question;

  // ── Haiku call ──────────────────────────────────────────────────────────────
  let answer = 'No relevant info found in your documents.';
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Context:\n${fullContext}\n\nQuestion: ${effectiveQuestion}` }],
    });
    answer = (resp.content[0]?.text || '').trim() || answer;
  } catch (e) {
    console.error('[query] Sonnet call failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
  console.log(`[query] haiku done (+${Date.now() - _t}ms)`); _t = Date.now();

  res.json({ answer, sources: [], followUps: [], routingDecision: 'DOCS' });
});

app.post('/query/alternatives', async (req, res) => {
  const { question, previousAnswer } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });

  // Step 1: ask Claude for 3 alternative phrasings
  let phrasings = [];
  try {
    const pr = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: `Generate 3 alternative phrasings of this question that might surface different information. Return ONLY a valid JSON array of 3 strings.\n\nQuestion: ${question}` }],
    });
    const raw = (pr.content[0]?.text || '').trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned.match(/\[[\s\S]*\]/)?.[0] || '[]');
    if (Array.isArray(parsed)) phrasings = parsed.slice(0, 3).map(String);
  } catch (e) {
    console.error('[alternatives] phrasing generation failed:', e.message);
  }
  if (!phrasings.length) return res.json({ alternatives: [] });

  // Step 2: search each phrasing and filter out answers too similar to previousAnswer
  function roughlySimilar(a, b) {
    if (!a || !b) return false;
    const stop = new Set(['the','a','an','is','are','was','were','have','has','had','will','would','could','should','what','how','who','when','where','this','that','it','of','in','on','at','to','for','with','and','but','or','not','our']);
    const words = (s) => s.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !stop.has(w));
    const setA = new Set(words(a));
    const wb = words(b);
    if (!wb.length) return false;
    return wb.filter(w => setA.has(w)).length / wb.length > 0.45;
  }

  const alternatives = [];
  for (const phrasing of phrasings) {
    try {
      const r = await liveWebSearch(phrasing, webSearchCfg.liveQuality || 'bestMatch');
      if (!r.answer || r.answer === 'SKIP') continue;
      if (roughlySimilar(previousAnswer, r.answer)) continue;
      alternatives.push({ label: phrasing, answer: r.answer });
    } catch (e) {
      console.error('[alternatives] search failed:', e.message);
    }
  }

  res.json({ alternatives });
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
    // Verify Haiku model availability for narrative summaries
    anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 5,
      messages: [{ role: 'user', content: 'ping' }],
    }).then(() => {
      console.log('[summary] Haiku model available — narrative summaries enabled');
    }).catch(e => {
      console.warn('[summary] Haiku model unavailable -- narrative summaries will use fallback text:', e.message);
    });

    // Backfill sidecars (fire and forget)
    (async () => {
      // Extract and save .extracted.txt sidecars for any missing files
      try {
        const data = loadProjects();
        for (const project of (data.projects || [])) {
          const uploadsDir = path.join(PROJECTS_DIR, project.id, 'uploads');
          if (!fs.existsSync(uploadsDir)) continue;
          const manifest = loadManifest(project.id);
          for (const entry of manifest) {
            const filePath = path.join(uploadsDir, entry.storedName);
            const sidecarPath = filePath + '.extracted.txt';
            const embeddingsPath = filePath + '.embeddings.json';

            let text = null;

            // Sidecar backfill (unchanged logic)
            if (!fs.existsSync(sidecarPath) && fs.existsSync(filePath)) {
              console.log(`[sidecar] Extracting text for ${entry.originalName}`);
              try {
                text = await extractText(filePath, '', entry.originalName);
                console.log('[sidecar] extracted text length:', text?.length || 0, 'for', entry.originalName);
                fs.writeFileSync(sidecarPath, text, 'utf-8');
              } catch (e) {
                console.error(`[sidecar] Failed to extract ${entry.originalName}:`, e.message);
              }
            }

            // Embeddings backfill — runs if sidecar exists but embeddings don't
            if (!fs.existsSync(embeddingsPath) && fs.existsSync(sidecarPath)) {
              try {
                if (!text) text = fs.readFileSync(sidecarPath, 'utf-8');
                const chunks = chunkText(text, entry.originalName);
                const embeddings = await generateEmbeddings(chunks);
                fs.writeFileSync(embeddingsPath, JSON.stringify(embeddings), 'utf-8');
                console.log(`[embeddings] Backfilled embeddings for ${entry.originalName}`);
              } catch (e) {
                console.error(`[embeddings] Backfill failed for ${entry.originalName}:`, e.message);
              }
            }
          }
        }
        console.log('[sidecar] Backfill complete');
      } catch (e) {
        console.error('[sidecar] Backfill failed:', e.message);
      }
    })();
  });
}

function setWebSearchConfig(cfg) {
  webSearchCfg = cfg || {};
  console.log('[config] Web search config updated:', webSearchCfg);
}

module.exports = { startWebhookServer, setWebSearchConfig, setCoachingCfg, setEngagementCfg };
