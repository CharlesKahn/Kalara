// ─── Engagement Score Engine ───────────────────────────────────────────────────
// Measures the other party's engagement (0-100) from transcript/timing signals.

const POSITIVE_WORDS = ['interesting', 'great', 'love', 'exactly', 'yes', 'absolutely', 'tell me more', 'impressive', 'makes sense', 'i see', 'good point', 'definitely', 'perfect', 'excellent'];
const NEGATIVE_WORDS = ['concerned', 'not sure', 'problem', 'issue', 'but', 'however', 'doubt', 'unclear', 'confused', 'expensive', 'risky', 'complicated', 'difficult'];

let cfg = { enabled: false, showSparkline: true, sentimentWeight: 0.5 };
let callStartTime = null;
let userSpeaker = null;

// Per-turn stats for the other party
let otherTurns = [];       // [{ text, wordCount, ts, latency, questions }]
let baselineWordCount = 0; // avg of first 3 turns
let baselineSet = false;

// Talk time
let userTalkMs  = 0;
let otherTalkMs = 0;
let lastSpeakerStart = null;
let lastSpeaker = null;

// Topics introduced by other party
let knownTopics = new Set();
let otherTopics = [];

// Score history (updated every 30s, calculated every 10s)
let scoreHistory = [];   // [{ ts, score }] max 10 entries
let lastScoreUpdate = 0;
let lastDisplayUpdate = 0;
let currentScore = 50;
let previousScore = 50;

// Callback
let scoreCallback = null;

// ─── Public API ───────────────────────────────────────────────────────────────
function setEngagementConfig(newCfg) {
  cfg = { ...cfg, ...newCfg };
}

function startEngagementSession(callback) {
  scoreCallback = callback;
  callStartTime = Date.now();
  userSpeaker = null;
  otherTurns = [];
  baselineWordCount = 0;
  baselineSet = false;
  userTalkMs = 0;
  otherTalkMs = 0;
  lastSpeakerStart = null;
  lastSpeaker = null;
  knownTopics = new Set();
  otherTopics = [];
  scoreHistory = [];
  lastScoreUpdate = 0;
  lastDisplayUpdate = 0;
  currentScore = 50;
  previousScore = 50;
}

function endEngagementSession() {
  scoreCallback = null;
  callStartTime = null;
}

function onTranscriptEvent(utterance) {
  if (!cfg.enabled || !callStartTime || !scoreCallback) return;

  const { speaker, text, ts } = utterance;
  const now = ts || Date.now();
  const words = text.trim().split(/\s+/);
  const wordCount = words.length;
  const lc = text.toLowerCase();

  if (!userSpeaker && speaker) userSpeaker = speaker;
  const isUser = speaker === userSpeaker;

  // Track talk time
  if (lastSpeaker && lastSpeakerStart) {
    const dur = now - lastSpeakerStart;
    if (lastSpeaker === userSpeaker) userTalkMs += dur;
    else otherTalkMs += dur;
  }
  lastSpeaker = speaker;
  lastSpeakerStart = now;

  if (!isUser) {
    // Measure response latency (approximate: time since last user word)
    const latency = 0; // We don't have exact end-of-speech timestamps

    // Count questions in other party's turn
    const questionCount = (text.match(/\?/g) || []).length;

    // Track new topics (simple: 3+ char words not previously mentioned)
    const newTopicWords = words.filter(w => w.length > 4 && !knownTopics.has(w.toLowerCase()));
    let newTopics = 0;
    newTopicWords.slice(0, 3).forEach(w => {
      const lw = w.toLowerCase().replace(/[^a-z]/g, '');
      if (!knownTopics.has(lw)) {
        knownTopics.add(lw);
        newTopics++;
        otherTopics.push({ word: lw, ts: now });
      }
    });

    otherTurns.push({ text: lc, wordCount, ts: now, latency, questions: questionCount, newTopics });

    // Establish baseline from first 3 turns
    if (!baselineSet && otherTurns.length >= 3) {
      const first3 = otherTurns.slice(0, 3);
      baselineWordCount = first3.reduce((s, t) => s + t.wordCount, 0) / 3;
      baselineSet = true;
    }

    // Add all words to known topics for user's side too
    words.forEach(w => {
      const lw = w.toLowerCase().replace(/[^a-z]/g, '');
      if (lw.length > 4) knownTopics.add(lw);
    });
  } else {
    // Add user's words to known topics
    words.forEach(w => {
      const lw = w.toLowerCase().replace(/[^a-z]/g, '');
      if (lw.length > 4) knownTopics.add(lw);
    });
  }
}

function tick() {
  if (!cfg.enabled || !callStartTime || !scoreCallback) return;
  const now = Date.now();
  if (now - callStartTime < 30000) return; // wait 30s before scoring

  if (now - lastScoreUpdate < 10000) return; // calculate every 10s
  lastScoreUpdate = now;

  calculateScore(now);

  // Emit to UI every 30s
  if (now - lastDisplayUpdate >= 30000) {
    lastDisplayUpdate = now;
    emitScore();
  }
}

function calculateScore(now) {
  const recent5m = now - 300000;
  const recentTurns = otherTurns.filter(t => t.ts > recent5m);
  if (recentTurns.length === 0 && otherTurns.length === 0) return;

  const allRecent = recentTurns.length > 0 ? recentTurns : otherTurns.slice(-5);

  // ── Signal 1: Response length (25%) ────────────────────────────────────────
  let responseLengthScore = 50;
  if (baselineSet && allRecent.length > 0) {
    const avgWords = allRecent.reduce((s, t) => s + t.wordCount, 0) / allRecent.length;
    const ratio = avgWords / Math.max(baselineWordCount, 5);
    if (avgWords <= 1) responseLengthScore = 10; // one-word answers
    else if (avgWords > 30) responseLengthScore = 90; // paragraphs
    else responseLengthScore = Math.min(90, Math.max(10, 50 + (ratio - 1) * 40));
  }

  // ── Signal 2: Question frequency (25%) ─────────────────────────────────────
  const recentQuestions = allRecent.reduce((s, t) => s + t.questions, 0);
  const windowMins = Math.max(1, (now - Math.min(...allRecent.map(t => t.ts), now)) / 60000);
  const questionsPerMin = recentQuestions / windowMins;
  let questionFreqScore = 50;
  if (questionsPerMin === 0) questionFreqScore = 25;
  else if (questionsPerMin < 0.4) questionFreqScore = 50;
  else questionFreqScore = Math.min(95, 60 + questionsPerMin * 20);

  // ── Signal 3: Sentiment (20%) ───────────────────────────────────────────────
  let sentimentScore = 50;
  const last5turns = allRecent.slice(-5);
  if (last5turns.length > 0) {
    let sentSum = 0;
    for (const turn of last5turns) {
      const pos = POSITIVE_WORDS.filter(w => turn.text.includes(w)).length;
      const neg = NEGATIVE_WORDS.filter(w => turn.text.includes(w)).length;
      sentSum += 50 + pos * 12 - neg * 8;
    }
    sentimentScore = Math.min(95, Math.max(10, sentSum / last5turns.length));
  }

  // ── Signal 4: Talk time ratio (15%) ────────────────────────────────────────
  const totalTalk = userTalkMs + otherTalkMs;
  let talkRatioScore = 50;
  if (totalTalk > 10000) {
    const otherPct = otherTalkMs / totalTalk;
    if (otherPct < 0.2) talkRatioScore = 20; // monologuing
    else if (otherPct < 0.3) talkRatioScore = 40;
    else if (otherPct < 0.5) talkRatioScore = 70; // healthy range
    else talkRatioScore = 55; // other party dominating — neutral
  }

  // ── Signal 5: Response latency (15%) — approximate ─────────────────────────
  const latencyScore = 60; // default neutral (no precise timing)

  // ── Signal 6: Topic expansion (10%) ────────────────────────────────────────
  const recentTopics = otherTopics.filter(t => t.ts > recent5m).length;
  const topicScore = Math.min(90, 40 + recentTopics * 8);

  // ── Weighted combination ────────────────────────────────────────────────────
  const sentW = cfg.sentimentWeight || 0.5; // 0=behavioral, 1=sentiment
  const raw = (
    responseLengthScore * 0.25 +
    questionFreqScore   * 0.25 +
    sentimentScore      * 0.20 * sentW * 2 +
    talkRatioScore      * 0.15 * (1 - sentW) * 2 +
    latencyScore        * 0.15 +
    topicScore          * 0.10
  );

  // Smooth: no single update moves score more than 8 points
  const delta = raw - currentScore;
  previousScore = currentScore;
  currentScore = currentScore + Math.max(-8, Math.min(8, delta));
  currentScore = Math.round(Math.max(0, Math.min(100, currentScore)));
}

function emitScore() {
  if (!scoreCallback) return;
  const score = currentScore;
  const trend = score > previousScore + 2 ? 'up' : score < previousScore - 2 ? 'down' : 'stable';
  const label = score <= 25 ? 'Cold' : score <= 50 ? 'Neutral' : score <= 75 ? 'Engaged' : 'Hot';
  const color = score <= 25 ? '#60a5fa' : score <= 50 ? '#9ca3af' : score <= 75 ? '#22c55e' : '#f59e0b';
  scoreHistory.push({ ts: Date.now(), score });
  if (scoreHistory.length > 10) scoreHistory.shift();
  scoreCallback({ score, trend, label, color, history: [...scoreHistory], showSparkline: cfg.showSparkline !== false });
}

function getScoreHistory() {
  return [...scoreHistory];
}

module.exports = {
  setEngagementConfig,
  startEngagementSession,
  endEngagementSession,
  onTranscriptEvent,
  tick,
  getScoreHistory,
};
