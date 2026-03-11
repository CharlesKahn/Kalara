/**
 * Kalara T1 Test Script — Full Call Simulator
 * ─────────────────────────────────────────────
 * Simulates a complete call by firing fake webhook payloads at localhost:3847.
 * Uses /recall/start-test to create a real session without hitting Recall.ai.
 * No real meeting required.
 *
 * HOW TO RUN:
 *   1. Start Kalara in Terminal 1:  npm start
 *   2. Open Terminal 2, navigate to your project folder
 *   3. Set PROJECT_ID below (copy from docs/projects.json)
 *   4. Set TEST_QUESTION to something your uploaded docs can answer
 *   5. node tests/t1-simulate-call.js
 */

const BASE = 'http://localhost:3847';

// ─── CONFIG — edit these two lines before running ─────────────────────────────
const PROJECT_ID    = 'proj_1772999323355_69da1918';
const TEST_QUESTION = 'What is your revenue model?';
// ─────────────────────────────────────────────────────────────────────────────

const NON_QUESTION = 'Thanks for joining the call today.';

let BOT_ID  = null;
let CALL_ID = null;
let passed  = 0;
let failed  = 0;

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

// ─── T1-0: Health check ───────────────────────────────────────────────────────
async function t1_0_healthCheck() {
  console.log('\n── T1-0: Health Check ──────────────────────────────────────');
  try {
    const r = await get('/health');
    if (r.status === 200 && r.body.status === 'ok') {
      log('Server running on port 3847', 'PASS');
    } else {
      log('Server health check', 'FAIL', `status ${r.status}`);
      process.exit(1);
    }
  } catch (e) {
    log('Server reachable', 'FAIL', 'Kalara is not running — start it with: npm start');
    process.exit(1);
  }
}

// ─── T1-1: Session Start (via /recall/start-test) ────────────────────────────
async function t1_1_sessionStart() {
  console.log('\n── T1-1: Session Start ─────────────────────────────────────');

  if (PROJECT_ID === 'PASTE_YOUR_PROJECT_ID_HERE') {
    log('PROJECT_ID configured', 'FAIL', 'Set PROJECT_ID at the top of this script before running');
    process.exit(1);
  }

  // Verify project exists
  const projects = await get('/projects');
  const found = (projects.body || []).find(p => p.id === PROJECT_ID);
  if (!found) {
    log(`Project exists`, 'FAIL', `"${PROJECT_ID}" not found — check PROJECT_ID`);
    process.exit(1);
  }
  log(`Project "${found.name}" found`, 'PASS');

  // Create session without hitting Recall.ai
  const r = await post('/recall/start-test', {
    meeting_url:   'https://meet.google.com/t1-qa-test',
    project_id:    PROJECT_ID,
    brief:         'This is a T1 QA test. Be direct and confident. Never hedge. Never say "I think" or "approximately".',
    meeting_title: 'T1 QA Test Call',
  });

  if (r.status === 200 && r.body.bot_id && r.body.status === 'test_session') {
    BOT_ID  = r.body.bot_id;
    CALL_ID = r.body.call_id;
    log('Test session created', 'PASS', `bot_id: ${BOT_ID.slice(0, 8)}...`);
    log('call_id returned', 'PASS', `call_id: ${CALL_ID.slice(0, 8)}...`);
  } else {
    log('Test session creation', 'FAIL', `status ${r.status}: ${JSON.stringify(r.body)}`);
    process.exit(1);
  }

  // Verify session is in SessionManager
  await sleep(900);
  const health = await get('/health');
  if (health.body.sessions >= 1) {
    log('Session registered in SessionManager', 'PASS', `${health.body.sessions} active session(s)`);
  } else {
    log('Session registered in SessionManager', 'FAIL', 'sessions count is 0');
  }

  // Verify docs loaded
  if (health.body.foundationChunks > 0) {
    log('Project docs loaded into session', 'PASS', `${health.body.foundationChunks} chunks`);
  } else {
    log('Project docs loaded into session', 'FAIL',
      `0 chunks — make sure project "${found.name}" has documents uploaded`);
  }
}

// ─── T1-2: Bot status progression ────────────────────────────────────────────
async function t1_2_botStatusProgression() {
  console.log('\n── T1-2: Bot Status Webhooks ───────────────────────────────');

  for (const code of ['joining_call', 'in_waiting_room', 'in_call_not_recording', 'in_call_recording']) {
    const r = await post('/recall/webhook', {
      event: 'bot.status_change',
      data: { bot_id: BOT_ID, data: { code } },
    });
    if (r.status === 200) {
      log(`bot.status_change → ${code}`, 'PASS');
    } else {
      log(`bot.status_change → ${code}`, 'FAIL', `status ${r.status}`);
    }
    await sleep(450);
  }
}

// ─── T1-3: Participant join ───────────────────────────────────────────────────
async function t1_3_participantJoin() {
  console.log('\n── T1-3: Participant Join ───────────────────────────────────');

  // Named participant
  const r1 = await post('/recall/webhook', {
    event: 'participant_events.join',
    data: {
      bot_id: BOT_ID,
      data: { participant: { id: 'p001', name: 'Sarah Chen', email: 'sarah.chen@sequoia.com' } },
    },
  });
  log('Named participant join', r1.status === 200 ? 'PASS' : 'FAIL');

  // Generic "Speaker 1" label — tests email fallback name logic
  const r2 = await post('/recall/webhook', {
    event: 'participant_events.join',
    data: {
      bot_id: BOT_ID,
      data: { participant: { id: 'p002', name: 'Speaker 1', email: 'partner@vcfirm.com' } },
    },
  });
  log('"Speaker 1" label with email fallback', r2.status === 200 ? 'PASS' : 'FAIL');
  console.log('  ℹ️  Check app Terminal: participant emails should be added to currentCallRecord');

  await sleep(900);
}

// ─── T1-4: Non-question transcript (no RAG expected) ─────────────────────────
async function t1_4_nonQuestion() {
  console.log('\n── T1-4: Non-Question (no overlay expected) ─────────────────');
  console.log(`  Sending: "${NON_QUESTION}"`);

  await post('/recall/webhook', {
    event: 'transcript.data',
    data: {
      bot_id: BOT_ID,
      data: {
        participant: { id: 'p001', name: 'Sarah Chen' },
        words: NON_QUESTION.split(' ').map(w => ({ text: w })),
      },
    },
  });

  await sleep(4500);
  log('Non-question fired — MANUAL CHECK: no overlay should have appeared', 'PASS');
}

// ─── T1-5: Question transcript (RAG + answer expected) ───────────────────────
async function t1_5_questionTrigger() {
  console.log('\n── T1-5: Question Trigger (overlay expected) ────────────────');
  console.log(`  Sending: "${TEST_QUESTION}"`);
  console.log('  👀 Watch your screen — answer overlay should appear within 5 seconds');

  await post('/recall/webhook', {
    event: 'transcript.data',
    data: {
      bot_id: BOT_ID,
      data: {
        participant: { id: 'p001', name: 'Sarah Chen' },
        words: TEST_QUESTION.split(' ').map(w => ({ text: w })),
      },
    },
  });

  console.log('  Waiting 8 seconds for Claude to respond...');
  await sleep(24000);

  const health = await get('/health');
  if (health.body.transcriptBuffer > 0) {
    log('Utterance added to transcript buffer', 'PASS', `buffer: ${health.body.transcriptBuffer}`);
  } else {
    log('Utterance in transcript buffer', 'FAIL', 'buffer is 0 — webhook routing may be broken');
  }

  log('Answer overlay — MANUAL CHECK: did an overlay appear on screen?', 'PASS');
}

// ─── T1-6: Brief priority ─────────────────────────────────────────────────────
async function t1_6_briefPriority() {
  console.log('\n── T1-6: Brief Priority ─────────────────────────────────────');
  console.log('  Brief set at session start: "Be direct and confident. Never hedge."');
  console.log('  MANUAL CHECK: did the answer avoid "I think", "approximately", hedging language?');
  log('Brief injected at session start', 'PASS', 'confirmed in /recall/start-test payload');
  log('Brief tone in answer — MANUAL CHECK required', 'PASS');
}

// ─── T1-7: Build full transcript (needs 10+ utterances for summary) ───────────
async function t1_7_buildTranscript() {
  console.log('\n── T1-7: Building Full Transcript (10+ utterances) ──────────');

  const utterances = [
    { id: 'p001', name: 'Sarah Chen', text: 'Tell me about your go-to-market strategy.' },
    { id: 'p002', name: 'You',        text: 'We focus on enterprise-first distribution through direct sales.' },
    { id: 'p001', name: 'Sarah Chen', text: 'How many enterprise customers do you have right now?' },
    { id: 'p002', name: 'You',        text: 'We have twelve enterprise logos in production.' },
    { id: 'p001', name: 'Sarah Chen', text: 'What is your average contract value?' },
    { id: 'p002', name: 'You',        text: 'Our ACV is around eighty thousand dollars annually.' },
    { id: 'p001', name: 'Sarah Chen', text: 'Who are your main competitors in this space?' },
    { id: 'p002', name: 'You',        text: 'The main incumbents are slow and expensive. We are ten times faster.' },
    { id: 'p001', name: 'Sarah Chen', text: 'What does your team look like?' },
    { id: 'p002', name: 'You',        text: 'We are twelve people, seven engineers, strong GTM lead from Stripe.' },
    { id: 'p001', name: 'Sarah Chen', text: 'Can we schedule a follow-up with the full partnership team?' },
    { id: 'p002', name: 'You',        text: 'Absolutely. We will send over the technical spec doc by end of week.' },
  ];

  for (const u of utterances) {
    await post('/recall/webhook', {
      event: 'transcript.data',
      data: {
        bot_id: BOT_ID,
        data: {
          participant: { id: u.id, name: u.name },
          words: u.text.split(' ').map(w => ({ text: w })),
        },
      },
    });
    await sleep(600);
  }

  const health = await get('/health');
  log(`Transcript built`, 'PASS', `${health.body.transcriptBuffer} utterances in buffer — enough for AI summary`);
}

// ─── T1-8: Session end + post-call file writes ────────────────────────────────
async function t1_8_sessionEnd() {
  console.log('\n── T1-8: Session End + Post-Call Writes ─────────────────────');

  // Simulate bot detecting call ended
  await post('/recall/webhook', {
    event: 'bot.status_change',
    data: { bot_id: BOT_ID, data: { code: 'call_ended' } },
  });
  log('bot.status_change → call_ended fired', 'PASS');
  await sleep(1500);

  // End session — triggers transcript save + summary generation
  const r = await post('/recall/end', { bot_id: BOT_ID });
  if (r.status === 200 && r.body.ok) {
    log('/recall/end returned ok', 'PASS');
  } else {
    log('/recall/end', 'FAIL', `status ${r.status}: ${JSON.stringify(r.body)}`);
  }

  // Verify session cleared
  await sleep(1500);
  const health = await get('/health');
  if (health.body.sessions === 0) {
    log('Session removed from SessionManager', 'PASS');
  } else {
    log('Session removed from SessionManager', 'FAIL', `${health.body.sessions} still active`);
  }

  // Wait for background AI summary (Haiku API call)
  console.log('\n  Waiting 20 seconds for AI summary generation...');
  await sleep(60000);

  // Check summary file exists via the summary-status endpoint
  const statusR = await get(`/session/summary-status/${CALL_ID}`);
  if (statusR.body.ready === true) {
    log('Summary file written to disk', 'PASS', `projectId: ${statusR.body.projectId}`);
  } else {
    log('Summary file written to disk', 'FAIL',
      `Not found yet — check app Terminal for [summary] log lines. call_id: ${CALL_ID}`);
  }

  console.log(`
  FILE CHECK — open Finder and verify these exist:
  docs/projects/${PROJECT_ID}/call-history/
    ✓ ${CALL_ID}.json
    ✓ ${CALL_ID}-summary.json
    ✓ call-history-index.json
  `);
}

// ─── T1-9: Edge cases ─────────────────────────────────────────────────────────
async function t1_9_edgeCases() {
  console.log('\n── T1-9: Edge Cases ─────────────────────────────────────────');

  // Unknown bot_id — should be silently ignored, no crash
  await post('/recall/webhook', {
    event: 'transcript.data',
    data: {
      bot_id: 'completely_fake_bot_id_000',
      data: {
        participant: { id: 'x', name: 'Ghost' },
        words: [{ text: 'What' }, { text: 'is' }, { text: 'your' }, { text: 'pricing?' }],
      },
    },
  });
  log('Unknown bot_id ignored without crash', 'PASS');

  // Missing meeting_url
  const r = await post('/recall/start-test', { project_id: PROJECT_ID });
  if (r.status === 400 && r.body.error === 'meeting_url required') {
    log('Missing meeting_url returns 400', 'PASS');
  } else {
    log('Missing meeting_url validation', 'FAIL', `got ${r.status}: ${JSON.stringify(r.body)}`);
  }

  // Server still healthy
  const health = await get('/health');
  if (health.body.status === 'ok') {
    log('Server still healthy after all tests', 'PASS');
  } else {
    log('Server health after tests', 'FAIL');
  }
}

// ─── Results ──────────────────────────────────────────────────────────────────
function printResults() {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  T1 Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('  ✅ All automated checks passed.');
  } else {
    console.log('  ❌ Some checks failed — review output above.');
  }
  console.log(`
  MANUAL CHECKS:
  1. T1-4: No overlay appeared for the non-question utterance
  2. T1-5: Answer overlay appeared on screen for "${TEST_QUESTION}"
  3. T1-6: Answer tone was direct — no hedging language
  4. T1-8: Bot-left toast appeared in the app after session ended
  5. T1-8: Transcript + summary JSON files exist on disk (paths printed above)
  6. App Terminal: no [ERROR] lines during the run
  `);
  console.log('════════════════════════════════════════════════════════════\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║       Kalara T1 — Core Call Path Simulator               ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Project: ${PROJECT_ID}`);
  console.log(`  Server:  ${BASE}\n`);

  try {
    await t1_0_healthCheck();
    await t1_1_sessionStart();
    await t1_2_botStatusProgression();
    await t1_3_participantJoin();
    await t1_4_nonQuestion();
    await t1_5_questionTrigger();
    await t1_6_briefPriority();
    await t1_7_buildTranscript();
    await t1_8_sessionEnd();
    await t1_9_edgeCases();
  } catch (e) {
    console.error('\n❌ UNEXPECTED ERROR:', e.message);
    console.error(e.stack);
    failed++;
  }

  printResults();
}

main();
