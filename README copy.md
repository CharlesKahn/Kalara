# Brio Pilot

Real-time pitch intelligence overlay. Listens to investor calls via Recall.ai, RAGs against your pitch docs, surfaces answers as a floating overlay.

## Architecture

```
Recall.ai bot (joins call)
    → real-time transcript webhook
        → local Express server (port 3847)
            → question detection
            → RAG against your docs (keyword search, upgradeable to embeddings)
            → Claude Sonnet for answer generation
                → Electron IPC
                    → Top bar overlay (auto-hide, appears on question detection)
                    → Sidebar (awareness mode, always-on)
```

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, RECALL_API_KEY, WEBHOOK_URL
```

### 3. Expose local webhook (for Recall.ai to reach you)
```bash
# Install ngrok if you don't have it
brew install ngrok
ngrok http 3847
# Copy the https URL into WEBHOOK_URL in .env
```

### 4. Run
```bash
npm run dev
```

### 5. Upload your pitch docs
- Click the Brio Pilot menubar icon
- Select "Upload Documents"
- Drag in your pitch deck PDF, FAQ doc, objection handling doc

### 6. Start a session
- Click "Start Recall Session"
- Paste the meeting link (Google Meet, Zoom, Teams all work)
- The Recall.ai bot joins silently

## Modes

**Default (passive):** App is invisible. When a question is detected, the top bar slides down with an answer, auto-hides after 12 seconds.

**Awareness Mode:** Toggle from menubar. Sidebar opens showing live transcript + answer history. You can also type manual queries into the sidebar search bar.

## Upgrading the search

The current implementation uses keyword matching (fast, no cost, good enough for MVP). To upgrade to semantic search:

1. Add OpenAI embeddings (or use Claude's embeddings via Voyage AI)
2. Replace the `ragQuery` keyword scoring with cosine similarity against embedded chunks
3. ChromaDB is already wired in for this — just needs the embedding step added

## Recall.ai webhook events

The server listens for:
- `transcript.partial_update` — real-time word-level updates
- `transcript.word` — individual word events

Adjust in `src/server/webhook.js` based on which Recall plan you're on.
