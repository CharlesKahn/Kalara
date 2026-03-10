// ─── Live Coaching Engine ──────────────────────────────────────────────────────
// Analyzes transcript events and emits coaching nudges.

const WARMUP_MS = 60 * 1000; // 60s before coaching starts

// ─── Default config ───────────────────────────────────────────────────────────
const DEFAULT_CFG = {
  enabled: false,
  pitchMode: false,
  sensitivity: 'medium', // low | medium | high
  cooldownMs: 30000,
  categories: {
    pace: true, monologue: true, fillerWords: true, weakLanguage: true,
    questionFreq: true, interruptions: true,
    objections: true, buyingSignals: true, competitors: true, financials: true,
    silence: true,
  },
};

// Sensitivity multipliers for time thresholds (higher = more aggressive = shorter thresholds)
const SENSITIVITY = {
  low:    { pace: 1.5, monologue: 1.5, fillerWords: 1.5, weakLanguage: 1.5, questionFreq: 1.5, interruptions: 1.5, silence: 1.5 },
  medium: { pace: 1.0, monologue: 1.0, fillerWords: 1.0, weakLanguage: 1.0, questionFreq: 1.0, interruptions: 1.0, silence: 1.0 },
  high:   { pace: 0.7, monologue: 0.7, fillerWords: 0.7, weakLanguage: 0.7, questionFreq: 0.7, interruptions: 0.7, silence: 0.7 },
};

const FILLER_WORDS = ['um', 'uh', 'like', 'you know', 'basically', 'literally', 'right?', 'so yeah', 'kind of', 'sort of'];
const WEAK_PHRASES = ['i think', 'i believe', 'maybe', 'perhaps', 'kind of', 'sort of', 'hopefully', "we're trying to", "we're attempting to", "i'm not sure but"];
const OBJECTION_PHRASES = ['concerned about', 'not sure about', 'how do you compare', 'what about', 'the problem is', "i'm worried", 'that seems', 'have you considered', 'what happens if', 'how does that work'];
const BUYING_PHRASES = ['tell me more', 'interesting', 'how would that work for us', 'what would next steps be', 'who else is using this', 'what does pricing look like', "we've seen this before", 'that resonates', 'i like that'];
const FINANCIAL_WORDS = ['valuation', 'price', 'cost', 'how much', "what's the ask", 'runway', 'burn rate', 'revenue', 'arr', 'mrr'];

// ─── Coaching state ───────────────────────────────────────────────────────────
let cfg = { ...DEFAULT_CFG };
let callStartTime = null;
let userSpeaker = null; // identified by first speaker or config

// Rolling word windows
let wordTimestamps = []; // [{ text, ts, speaker }]
let speechSegments = []; // [{ speaker, startTs, endTs, wordCount }]

// Monologuing
let userMonologueStart = null;
let lastOtherSentence = 0;

// Filler word tracking (rolling 2-min window)
let fillerLog = []; // [{ word, ts }]

// Weak language tracking (rolling 2-min window)
let weakLog = []; // [{ ts }]

// Question frequency
let lastUserQuestionTs = 0;
let otherSpeakCount = 0; // times other party spoke since last user question check

// Interruption tracking
let lastOtherEndTs = 0;
let interruptionLog = []; // [ts]

// Silence
let lastSpeechTs = 0;
let silenceNudgeSent = 0;

// Cooldowns
let lastNudgeTs = 0;
let categoryLastNudge = {};

// Competitor names (from project docs)
let competitorNames = [];
let financialNudgeClusters = []; // [ts] to prevent re-triggering

// Nudge callback
let nudgeCallback = null;

// ─── Public API ───────────────────────────────────────────────────────────────
function setCoachingConfig(newCfg) {
  cfg = { ...DEFAULT_CFG, ...newCfg };
  if (newCfg.categories) cfg.categories = { ...DEFAULT_CFG.categories, ...newCfg.categories };
}

function setCompetitorNames(names) {
  competitorNames = names.map(n => n.toLowerCase());
}

function startCoachingSession(callback) {
  nudgeCallback = callback;
  callStartTime = Date.now();
  userSpeaker = null;
  wordTimestamps = [];
  speechSegments = [];
  userMonologueStart = null;
  lastOtherSentence = 0;
  fillerLog = [];
  weakLog = [];
  lastUserQuestionTs = Date.now();
  otherSpeakCount = 0;
  lastOtherEndTs = 0;
  interruptionLog = [];
  lastSpeechTs = Date.now();
  silenceNudgeSent = 0;
  lastNudgeTs = 0;
  categoryLastNudge = {};
  financialNudgeClusters = [];
}

function endCoachingSession() {
  nudgeCallback = null;
  callStartTime = null;
}

function onTranscriptEvent(utterance) {
  if (!nudgeCallback || !cfg.enabled || !callStartTime) return;
  if (Date.now() - callStartTime < WARMUP_MS) return; // warmup period

  const { speaker, text, ts } = utterance;
  const now = ts || Date.now();
  lastSpeechTs = now;

  // Identify user speaker (first speaker heuristic or config)
  if (!userSpeaker && speaker) userSpeaker = speaker;

  const isUser = speaker === userSpeaker;
  const words = text.trim().split(/\s+/);
  const wordCount = words.length;
  const lc = text.toLowerCase();

  // Record speech segment
  speechSegments.push({ speaker, startTs: now - wordCount * 400, endTs: now, wordCount, text: lc });

  // Record word timestamps for WPM
  words.forEach((w, i) => {
    wordTimestamps.push({ text: w.toLowerCase(), ts: now - (wordCount - 1 - i) * 400, speaker });
  });
  // Trim to last 30 seconds
  const cutoff30 = now - 30000;
  wordTimestamps = wordTimestamps.filter(w => w.ts > cutoff30);

  const s = sensitivityFactor();

  if (isUser) {
    checkSpeechPace(speaker, now, s);
    checkMonologue(speaker, now, s);
    checkFillerWords(lc, now, s);
    checkWeakLanguage(lc, now, s);
    checkQuestionFrequency(lc, now, s);
    checkInterruptions(now, s);
  } else {
    otherSpeakCount++;
    lastOtherEndTs = now;
    checkOtherPartyPhrases(lc, now);
    // reset monologue when other party speaks a full sentence
    if (wordCount > 5) {
      lastOtherSentence = now;
      userMonologueStart = null;
    }
  }
}

// Run on a tick (for silence detection)
function tick() {
  if (!nudgeCallback || !cfg.enabled || !callStartTime) return;
  if (Date.now() - callStartTime < WARMUP_MS) return;
  checkSilence(Date.now());
}

// ─── Individual checks ────────────────────────────────────────────────────────
function sensitivityFactor() {
  return SENSITIVITY[cfg.sensitivity || 'medium'];
}

function canNudge(category, cooldownOverride) {
  const now = Date.now();
  if (now - lastNudgeTs < cfg.cooldownMs) return false; // global cooldown
  const catCooldown = cooldownOverride || 300000; // 5 min default
  if (now - (categoryLastNudge[category] || 0) < catCooldown) return false;
  return true;
}

function emit(nudge) {
  const now = Date.now();
  lastNudgeTs = now;
  categoryLastNudge[nudge.category] = now;
  nudgeCallback(nudge);
}

function checkSpeechPace(speaker, now, s) {
  if (!cfg.categories.pace) return;
  const window20s = now - 20000 * s.pace;
  const recentWords = wordTimestamps.filter(w => w.ts > window20s && w.speaker === speaker);
  const wpm = (recentWords.length / 20) * 60;
  if (wpm > 160 && canNudge('pace', 30000)) {
    emit({ category: 'pace', message: 'Slow down', color: 'amber', priority: 'normal' });
  } else if (wpm > 0 && wpm < 80 && canNudge('pace', 30000)) {
    emit({ category: 'pace', message: 'Pick up the pace', color: 'amber', priority: 'normal' });
  }
}

function checkMonologue(speaker, now, s) {
  if (!cfg.categories.monologue) return;
  if (!userMonologueStart) userMonologueStart = now;
  const monoMs = 90000 * s.monologue;
  const monoSinceOther = now - lastOtherSentence > monoMs;
  if (now - userMonologueStart > monoMs && monoSinceOther && canNudge('monologue', 180000)) {
    emit({ category: 'monologue', message: 'Check in — ask a question', color: 'amber', priority: 'normal' });
    userMonologueStart = now; // reset
  }
}

function checkFillerWords(lc, now, s) {
  if (!cfg.categories.fillerWords) return;
  const filler = FILLER_WORDS.find(f => lc.includes(f));
  if (!filler) return;
  fillerLog.push({ word: filler, ts: now });
  // Trim to 2-min window
  const cut = now - 120000 * s.fillerWords;
  fillerLog = fillerLog.filter(e => e.ts > cut);
  // Count per filler
  const counts = {};
  fillerLog.forEach(e => { counts[e.word] = (counts[e.word] || 0) + 1; });
  const worst = Object.entries(counts).find(([, c]) => c > 3);
  if (worst && canNudge('fillerWords', 300000)) {
    emit({ category: 'fillerWords', message: 'Watch the filler words', color: 'amber', priority: 'normal' });
  }
}

function checkWeakLanguage(lc, now, s) {
  if (!cfg.categories.weakLanguage) return;
  if (!WEAK_PHRASES.some(p => lc.includes(p))) return;
  weakLog.push({ ts: now });
  const cut = now - 120000 * s.weakLanguage;
  weakLog = weakLog.filter(e => e.ts > cut);
  if (weakLog.length >= 3 && canNudge('weakLanguage', 300000)) {
    emit({ category: 'weakLanguage', message: 'Speak with conviction', color: 'amber', priority: 'normal' });
  }
}

function checkQuestionFrequency(lc, now, s) {
  if (!cfg.categories.questionFreq) return;
  if (lc.trim().endsWith('?')) lastUserQuestionTs = now;
  const elapsed = now - lastUserQuestionTs;
  const threshold = 240000 * s.questionFreq;
  if (elapsed > threshold && otherSpeakCount >= 3 && canNudge('questionFreq', 300000)) {
    emit({ category: 'questionFreq', message: 'Ask a question — get them talking', color: 'amber', priority: 'normal' });
    lastUserQuestionTs = now;
  }
}

function checkInterruptions(now, s) {
  if (!cfg.categories.interruptions) return;
  if (!lastOtherEndTs) return;
  const gap = now - lastOtherEndTs;
  if (gap < 500 * s.interruptions && gap > 50) { // 0.5s threshold, ignore very fast responses
    const lastWord = wordTimestamps.filter(w => w.speaker === userSpeaker).slice(-1)[0]?.text || '';
    const isAffirmation = ['yes', 'right', 'exactly', 'got it', 'ok', 'sure', 'mm', 'yeah'].includes(lastWord.replace(/[^a-z]/g, ''));
    if (!isAffirmation) {
      interruptionLog.push(now);
      const cut = now - 300000 * s.interruptions;
      interruptionLog = interruptionLog.filter(t => t > cut);
      if (interruptionLog.length >= 3 && canNudge('interruptions', 300000)) {
        emit({ category: 'interruptions', message: 'Let them finish', color: 'amber', priority: 'normal' });
      }
    }
  }
}

function checkOtherPartyPhrases(lc, now) {
  // Objections — high priority, no frequency suppression
  if (cfg.categories.objections && OBJECTION_PHRASES.some(p => lc.includes(p))) {
    const globalCooldownOk = now - lastNudgeTs > Math.min(cfg.cooldownMs, 5000);
    const catCooldownOk = now - (categoryLastNudge['objections'] || 0) > 10000;
    if (globalCooldownOk && catCooldownOk) {
      emit({ category: 'objections', message: 'Objection detected — listen fully before responding', color: 'amber', priority: 'high' });
    }
  }

  // Buying signals — green, high priority
  if (cfg.categories.buyingSignals && BUYING_PHRASES.some(p => lc.includes(p))) {
    const catCooldownOk = now - (categoryLastNudge['buyingSignals'] || 0) > 10000;
    if (catCooldownOk) {
      emit({ category: 'buyingSignals', message: "Buying signal — keep going, don't oversell", color: 'green', priority: 'high' });
      categoryLastNudge['buyingSignals'] = now;
    }
    return;
  }

  // Competitor mentions
  if (cfg.categories.competitors && cfg.pitchMode) {
    const mentionedCompetitor = competitorNames.find(c => lc.includes(c));
    if (mentionedCompetitor) {
      const catCooldownOk = now - (categoryLastNudge['competitors'] || 0) > 30000;
      if (catCooldownOk) {
        emit({ category: 'competitors', message: "Competitor mentioned — stay confident, don't disparage", color: 'amber', priority: 'high' });
        categoryLastNudge['competitors'] = now;
      }
    }
  }

  // Financial mentions
  if (cfg.categories.financials && cfg.pitchMode) {
    if (FINANCIAL_WORDS.some(w => lc.includes(w))) {
      // Cluster: only fire once per 60s window
      financialNudgeClusters.push(now);
      financialNudgeClusters = financialNudgeClusters.filter(t => t > now - 60000);
      if (financialNudgeClusters.length === 1 && now - (categoryLastNudge['financials'] || 0) > 120000) {
        emit({ category: 'financials', message: 'Financials coming up — be precise', color: 'amber', priority: 'normal' });
        categoryLastNudge['financials'] = now;
      }
    }
  }
}

function checkSilence(now) {
  if (!cfg.categories.silence) return;
  if (!lastSpeechTs || now - lastSpeechTs < 8000) return;
  if (now - silenceNudgeSent < 600000) return; // once per 10 min
  if (now - callStartTime < 15000) return; // not at very start
  emit({ category: 'silence', message: 'Silence — ask a question or summarize', color: 'amber', priority: 'normal' });
  silenceNudgeSent = now;
  lastSpeechTs = now; // reset so we don't fire again immediately
}

module.exports = {
  setCoachingConfig,
  setCompetitorNames,
  startCoachingSession,
  endCoachingSession,
  onTranscriptEvent,
  tick,
};
