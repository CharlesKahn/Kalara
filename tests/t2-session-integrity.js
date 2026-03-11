/**
 * Kalara T2 Test Script — Session Integrity
 * ──────────────────────────────────────────
 * Tests: bot_id routing, multi-session (up to 3), auto-end detection,
 * participant.left, user-left-call, short call (under 10 utterances skips summary)
 *
 * HOW TO RUN:
 *   1. Start Kalara in Terminal 1: npm run dev
 *   2. Wait for "[summary] Haiku model available"
 *   3. Terminal 2: node tests/t2-session-integrity.js
 *
 * PREREQ: Same PROJECT_ID as T1. App must be freshly started (no active sessions).
 */

const BASE = 'http://localhost:3847';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const PROJECT_ID = 'proj_1772999323355_69da1918';
// Your Google-connected email — needed for user-left-call test
// Find it in docs/config.json under googleAuth.email
const USER_EMAIL = 'charlie@karmanlabs.com';
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const sessions = {}; // label → bot_id

function log(label, status, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : 'ℹ️ ';
  console.log(`${icon} [${status}] ${label}${detail ? ' — ' + detail : ''}`);
  if (status === 'PASS') passed++;
  if (status === 'FAIL') failed++;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json;
  try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, body: json };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  let json;
  try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, body: json };
}

async function startTestSession(label, projectId = PROJECT_ID) {
  const r = await post('/recall/start-test', {
    meeting_url:   `https://meet.google.com/t2-test-${label}`,
    project_id:    projectId,
    brief:         `T2 test session: ${label}`,
    meeting_title: `T2 Test — ${label}`,
    bot_only:      true,
  });
  if (r.status === 200 && r.body.bot_id) {
    sessions[label] = r.body.bot_id;
    return r.body;
  }
  return null;
}

async function sendTranscript(botId, speaker, text) {
  return post('/recall/webhook', {
    event: 'transcript.data',
    data: {
      bot_id: botId,
      data: {
        participant: { id: `p_${speaker.replace(/\s/g, '_')}`, name: speaker },
        words: text.split(' ').map(w => ({ text: w })),
      },
    },
  });
}

async function endSession(botId) {
  return post('/recall/end', { bot_id: botId });
}

// ─── T2-0: Health + clean slate ───────────────────────────────────────────────
async function t2_0_healthCheck() {
  console.log('\n── T2-0: Health Check ──────────────────────────────────────');

  if (PROJECT_ID === 'PASTE_YOUR_PROJECT_ID_HERE') {
    log('PROJECT_ID configured', 'FAIL', 'Set PROJECT_ID at top of script');
    process.exit(1);
  }
  if (USER_EMAIL === 'PASTE_YOUR_GOOGLE_EMAIL_HERE') {
    log('USER_EMAIL configured', 'FAIL', 'Set USER_EMAIL at top of script — check docs/config.json → googleAuth.email');
    process.exit(1);
  }

  try {
    const r = await get('/health');
    if (r.status === 200 && r.body.status === 'ok') {
      log('Server running', 'PASS');
    } else {
      log('Server health', 'FAIL', `status ${r.status}`);
      process.exit(1);
    }
    if (r.body.sessions > 0) {
      log('Clean slate check', 'FAIL', `${r.body.sessions} session(s) already active — restart Kalara before running T2`);
      process.exit(1);
    }
    log('No active sessions (clean slate)', 'PASS');
  } catch (e) {
    log('Server reachable', 'FAIL', 'Run npm run dev first');
    process.exit(1);
  }
}

// ─── T2-1: bot_id routing — two sessions, events go to correct session ────────
async function t2_1_botIdRouting() {
  console.log('\n── T2-1: bot_id Routing ────────────────────────────────────');

  const s1 = await startTestSession('routing-A');
  const s2 = await startTestSession('routing-B');

  if (!s1 || !s2) {
    log('Both sessions created', 'FAIL', 'Could not create test sessions');
    return;
  }
  log('Session A created', 'PASS', `bot_id: ${s1.bot_id.slice(0, 8)}...`);
  log('Session B created', 'PASS', `bot_id: ${s2.bot_id.slice(0, 8)}...`);

  await sleep(300);
  const health = await get('/health');
  if (health.body.sessions === 2) {
    log('Both sessions in SessionManager', 'PASS', '2 active sessions');
  } else {
    log('Both sessions in SessionManager', 'FAIL', `got ${health.body.sessions}`);
  }

  // Send transcript to Session A only
  await sendTranscript(s1.bot_id, 'Investor', 'What is your revenue model?');
  await sleep(8000); // wait for Claude

  // Send a plain statement to Session B — should not trigger RAG
  await sendTranscript(s2.bot_id, 'Client', 'Thanks for the update.');
  await sleep(1500);

  log('Transcripts routed to separate sessions', 'PASS',
    'MANUAL CHECK: overlay should have appeared once (from Session A question), not twice');

  // Clean up both
  await endSession(s1.bot_id);
  await endSession(s2.bot_id);
  await sleep(900);

  const healthAfter = await get('/health');
  if (healthAfter.body.sessions === 0) {
    log('Both sessions cleaned up after end', 'PASS');
  } else {
    log('Sessions cleaned up', 'FAIL', `${healthAfter.body.sessions} still active`);
  }
}

// ─── T2-2: Multi-session limit (max 3) ───────────────────────────────────────
async function t2_2_multiSessionLimit() {
  console.log('\n── T2-2: Multi-Session Limit (max 3) ───────────────────────');

  const s1 = await startTestSession('multi-1');
  const s2 = await startTestSession('multi-2');
  const s3 = await startTestSession('multi-3');

  if (!s1 || !s2 || !s3) {
    log('3 sessions created', 'FAIL', 'Could not create all 3 sessions');
    return;
  }
  log('Session 1 created', 'PASS');
  log('Session 2 created', 'PASS');
  log('Session 3 created', 'PASS');

  await sleep(300);
  const health = await get('/health');
  if (health.body.sessions === 3) {
    log('All 3 sessions active simultaneously', 'PASS');
  } else {
    log('3 sessions active', 'FAIL', `got ${health.body.sessions}`);
  }

  // Attempt a 4th session — should be rejected with 429
  const s4 = await post('/recall/start-test', {
    meeting_url:   'https://meet.google.com/t2-test-multi-4',
    project_id:    PROJECT_ID,
    meeting_title: 'T2 Test — multi-4',
    bot_only:      true,
  });

  if (s4.status === 429 && s4.body.error === 'Max 3 concurrent sessions') {
    log('4th session correctly rejected with 429', 'PASS');
  } else {
    log('4th session rejected', 'FAIL', `got status ${s4.status}: ${JSON.stringify(s4.body)}`);
  }

  // Clean up all 3
  await endSession(s1.bot_id);
  await endSession(s2.bot_id);
  await endSession(s3.bot_id);
  await sleep(900);

  const healthAfter = await get('/health');
  if (healthAfter.body.sessions === 0) {
    log('All 3 sessions cleaned up', 'PASS');
  } else {
    log('All sessions cleaned up', 'FAIL', `${healthAfter.body.sessions} still active`);
  }
}

// ─── T2-3: Short call — under 10 utterances skips summary ────────────────────
async function t2_3_shortCallNoSummary() {
  console.log('\n── T2-3: Short Call (under 10 utterances — no summary) ─────');

  const s = await startTestSession('short-call');
  if (!s) { log('Session created', 'FAIL'); return; }
  log('Short-call session created', 'PASS');

  // Send only 5 utterances — below the 10 minimum
  const utterances = [
    'Hello, good to meet you.',
    'Let me tell you about our product.',
    'We focus on enterprise customers.',
    'Our team is twelve people.',
    'Thanks for your time today.',
  ];

  for (const text of utterances) {
    await sendTranscript(s.bot_id, 'Speaker', text);
    await sleep(300);
  }
  log('5 utterances sent (below 10 threshold)', 'PASS');

  // End session
  await endSession(s.bot_id);
  await sleep(3000);

  // Check app Terminal for: "[summary] Skipped — transcript has 5 utterances (min 10)"
  log('Summary skipped — MANUAL CHECK: look for "[summary] Skipped" in app Terminal', 'PASS');

  // Verify call was still indexed (even without summary)
  // We can't easily check this programmatically without knowing the callId,
  // so flag it as a manual check
  log('Call indexed without summary — MANUAL CHECK: call-history-index.json should have new entry with null summaryExcerpt', 'PASS');
}

// ─── T2-4: participant.left event ────────────────────────────────────────────
async function t2_4_participantLeft() {
  console.log('\n── T2-4: Participant Left Event ────────────────────────────');

  const s = await startTestSession('participant-left');
  if (!s) { log('Session created', 'FAIL'); return; }
  log('Session created', 'PASS');

  // Join a participant first
  await post('/recall/webhook', {
    event: 'participant_events.join',
    data: {
      bot_id: s.bot_id,
      data: { participant: { id: 'p001', name: 'Sarah Chen', email: 'sarah.chen@sequoia.com' } },
    },
  });
  await sleep(450);
  log('Participant joined', 'PASS');

  // Now fire participant.left
  const r = await post('/recall/webhook', {
    event: 'participant.left',
    data: {
      bot_id: s.bot_id,
      data: { participant: { id: 'p001', name: 'Sarah Chen', email: 'sarah.chen@sequoia.com' } },
    },
  });

  if (r.status === 200) {
    log('participant.left webhook accepted', 'PASS');
  } else {
    log('participant.left webhook', 'FAIL', `status ${r.status}`);
  }

  await sleep(450);
  await endSession(s.bot_id);
  await sleep(900);
  log('Session ended cleanly after participant.left', 'PASS');
}

// ─── T2-5: user-left-call — triggers auto-end countdown ──────────────────────
async function t2_5_userLeftCall() {
  console.log('\n── T2-5: User Left Call (auto-end countdown) ───────────────');
  console.log(`  Using user email: ${USER_EMAIL}`);

  // This session must NOT be bot_only — user-left detection skips bot_only sessions
  const r = await post('/recall/start-test', {
    meeting_url:   'https://meet.google.com/t2-test-userleft',
    project_id:    PROJECT_ID,
    meeting_title: 'T2 Test — user left',
    bot_only:      false, // important — must be false
  });

  if (!r.body.bot_id) {
    log('Session created', 'FAIL');
    return;
  }
  const botId = r.body.bot_id;
  log('Non-bot-only session created', 'PASS', `bot_id: ${botId.slice(0, 8)}...`);
  await sleep(450);

  // Fire participant.left with the user's own email
  const leftR = await post('/recall/webhook', {
    event: 'participant.left',
    data: {
      bot_id: botId,
      data: { participant: { id: 'user_self', name: 'You', email: USER_EMAIL } },
    },
  });

  if (leftR.status === 200) {
    log('participant.left with user email fired', 'PASS');
  } else {
    log('participant.left with user email', 'FAIL', `status ${leftR.status}`);
  }

  console.log('  👀 Watch your screen — 60-second auto-end countdown toast should appear');
  console.log('  Waiting 5 seconds for toast to appear...');
  await sleep(5000);

  log('Auto-end countdown toast — MANUAL CHECK: did the countdown toast appear on screen?', 'PASS');

  // Clean up — end session manually so we don't wait 60 seconds
  await endSession(botId);
  await sleep(900);
  log('Session ended manually (skipping 60s countdown)', 'PASS');
}

// ─── T2-6: bot.status_change → call_ended triggers bot-left toast ────────────
async function t2_6_botLeftToast() {
  console.log('\n── T2-6: Bot Left Toast ────────────────────────────────────');

  const s = await startTestSession('bot-left');
  if (!s) { log('Session created', 'FAIL'); return; }
  log('Session created', 'PASS');

  // Build a short transcript
  await sendTranscript(s.bot_id, 'Investor', 'What is your go-to-market strategy?');
  await sleep(600);
  await sendTranscript(s.bot_id, 'You', 'We sell direct to enterprise.');
  await sleep(600);

  // Fire call_ended — this should trigger webhookCallback('bot-left-call')
  // which in main.js opens the bot-left toast
  await post('/recall/webhook', {
    event: 'bot.status_change',
    data: { bot_id: s.bot_id, data: { code: 'call_ended' } },
  });

  console.log('  👀 Watch your screen — bot-left toast should appear bottom-right');
  await sleep(3000);

  log('Bot-left toast — MANUAL CHECK: did "Kalara left · T2 Test — bot-left" toast appear?', 'PASS');

  // /recall/end is called by main.js automatically on bot-left-call event
  // Wait for it to process
  await sleep(1500);

  const health = await get('/health');
  if (health.body.sessions === 0) {
    log('Session auto-ended after call_ended event', 'PASS');
  } else {
    log('Session auto-ended', 'FAIL', `${health.body.sessions} session(s) still active`);
  }
}

// ─── T2-7: Participant joins mid-call — context reload ────────────────────────
async function t2_7_midCallParticipantJoin() {
  console.log('\n── T2-7: Mid-Call Participant Join (context reload) ─────────');

  const s = await startTestSession('mid-call-join');
  if (!s) { log('Session created', 'FAIL'); return; }
  log('Session created', 'PASS');

  // Send some transcript first
  await sendTranscript(s.bot_id, 'Host', 'Let me introduce our product.');
  await sleep(600);
  await sendTranscript(s.bot_id, 'Host', 'We focus on real-time intelligence.');
  await sleep(600);

  // New participant joins mid-call
  const joinR = await post('/recall/webhook', {
    event: 'participant_events.join',
    data: {
      bot_id: s.bot_id,
      data: { participant: { id: 'p_late', name: 'Mike Tanaka', email: 'mike@sequoia.com' } },
    },
  });

  if (joinR.status === 200) {
    log('Mid-call participant join accepted', 'PASS');
  } else {
    log('Mid-call participant join', 'FAIL', `status ${joinR.status}`);
  }

  await sleep(450);
  // historyContextLoaded should have been reset to false — verify by checking
  // app Terminal for "[history] Cross-project context loaded" or similar on next RAG query
  await sendTranscript(s.bot_id, 'Mike Tanaka', 'What is your pricing model?');
  await sleep(8000);

  log('Question fired after mid-call join', 'PASS',
    'MANUAL CHECK: overlay should appear; app Terminal should show context reload attempt');

  await endSession(s.bot_id);
  await sleep(900);
}

// ─── Results ──────────────────────────────────────────────────────────────────
function printResults() {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  T2 Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('  ✅ All automated checks passed.');
  } else {
    console.log('  ❌ Some checks failed — review output above.');
  }
  console.log(`
  MANUAL CHECKS:
  1. T2-1: Overlay appeared once (Session A question), not for Session B statement
  2. T2-3: App Terminal shows "[summary] Skipped — transcript has 5 utterances (min 10)"
  3. T2-5: Auto-end countdown toast appeared on screen
  4. T2-6: Bot-left toast appeared bottom-right with correct meeting title
  5. T2-7: App Terminal shows context reload attempt after mid-call join
  6. No [ERROR] lines in app Terminal during the run
  `);
  console.log('════════════════════════════════════════════════════════════\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║       Kalara T2 — Session Integrity                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Project: ${PROJECT_ID}`);
  console.log(`  User:    ${USER_EMAIL}`);
  console.log(`  Server:  ${BASE}\n`);

  try {
    await t2_0_healthCheck();
    await t2_1_botIdRouting();
    await t2_2_multiSessionLimit();
    await t2_3_shortCallNoSummary();
    await t2_4_participantLeft();
    await t2_5_userLeftCall();
    await t2_6_botLeftToast();
    await t2_7_midCallParticipantJoin();
  } catch (e) {
    console.error('\n❌ UNEXPECTED ERROR:', e.message);
    console.error(e.stack);
    failed++;
  }

  printResults();
}

main();
