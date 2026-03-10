# Kalara — Complete Product Overview

> A comprehensive guide to everything Kalara does, written for new users.

---

## Table of Contents

1. [What is Kalara?](#1-what-is-kalara)
2. [How It Works — The Simple Version](#2-how-it-works--the-simple-version)
3. [Getting Started](#3-getting-started)
4. [Projects — Your Knowledge Base](#4-projects--your-knowledge-base)
5. [Starting a Session — The Recall Setup](#5-starting-a-session--the-recall-setup)
6. [The Live Answer Overlay](#6-the-live-answer-overlay)
7. [Awareness Mode — The Sidebar](#7-awareness-mode--the-sidebar)
8. [Eyeline Mode — The Floating Pill](#8-eyeline-mode--the-floating-pill)
9. [The Call Brief](#9-the-call-brief)
10. [Calendar Integration & Auto-Join](#10-calendar-integration--auto-join)
11. [Meeting Alerts](#11-meeting-alerts)
12. [Participant Auto-Detection](#12-participant-auto-detection)
13. [Coaching & Engagement Intelligence](#13-coaching--engagement-intelligence)
14. [Web Search Intelligence](#14-web-search-intelligence)
15. [Post-Call Memory & Learning](#15-post-call-memory--learning)
16. [Session Management & Multi-Session](#16-session-management--multi-session)
17. [The Tray Menu](#17-the-tray-menu)
18. [Settings & Customization](#18-settings--customization)
19. [Data Storage & Privacy](#19-data-storage--privacy)

---

## 1. What is Kalara?

Kalara is a real-time AI assistant for your most important calls — investor meetings, sales conversations, customer demos, fundraising pitches. It sits quietly in the background while you talk and, the moment a question comes up that you should be able to answer, it surfaces the answer directly from your own documents as a discreet overlay on your screen.

Think of it as having a deeply prepared colleague sitting next to you with access to every document you've ever uploaded — pitch decks, financial models, product specs, FAQs, research papers — who can instantly find the exact information you need and flash it to you while you keep talking. You never have to pause, say "let me get back to you on that," or scramble through tabs and files. The answer is just there.

Kalara works with any video call platform — Google Meet, Zoom, Microsoft Teams, or any meeting with a link — because it doesn't intercept your screen share or camera. Instead, it sends a dedicated AI notetaker bot (called a "Recall bot") into the meeting. That bot listens to what's being said, and Kalara uses that transcript to understand what's happening and surface relevant information at exactly the right moment.

---

## 2. How It Works — The Simple Version

Here is the complete flow from start to finish:

**Before the call:**
You upload your documents — pitch decks, product specs, investor FAQs, case studies, financial models — into a Kalara "Project." A Project is simply a named collection of documents for a specific context (e.g., "Series A Fundraise" or "Acme Corp Demo"). You can have as many Projects as you like.

**When a call starts:**
Kalara sends a silent bot into your video call. The bot listens and transcribes everything being said in real time. You set up the session in about 30 seconds — paste the meeting link, pick your document collection, optionally write a brief about who you're talking to, and press Start.

**During the call:**
Kalara monitors the transcript constantly. The moment it detects a question that it can answer from your documents — "What's your revenue model?", "How many customers do you have?", "What's the timeline to market?" — it generates a concise 2–3 sentence answer using Claude AI and displays it as a floating overlay at the top of your screen. The answer disappears after a few seconds. You glance at it, keep talking, and sound completely prepared.

**After the call:**
Kalara saves a full transcript of the conversation and generates an AI-written summary covering the main topics, key decisions, and action items. This summary becomes part of Kalara's memory. On your next call with the same person, Kalara will surface relevant context from that previous conversation — so it gets smarter about every recurring relationship over time.

---

## 3. Getting Started

### Step 1 — Install and Launch
Kalara installs like any Mac app. Once running, it lives in your **menubar** as a small icon in the top-right corner of your screen. It does not have a dock icon or a traditional window — it's always ready but never in the way.

### Step 2 — Connect Google Calendar
Click the Kalara menubar icon and sign in with Google. This is optional but strongly recommended. Once connected, Kalara reads your upcoming Google Calendar meetings, detects which ones have a video call link, and can automatically join them on your behalf — so you never have to manually start a session.

### Step 3 — Create a Project
Open the tray menu → **Manage Projects**. Create a Project with a descriptive name (e.g., "Fundraise Q1 2026" or "Sales — Enterprise"). Upload your relevant documents — PDFs, Word docs, plain text, or Markdown files are all supported.

### Step 4 — Start Your First Session
When a call is about to start, click the Kalara tray icon → **Start Session**. Paste the meeting link, select your Project, optionally write a brief, and click Start. Kalara sends a bot into the call and begins listening within seconds.

### Step 5 — Talk Naturally
Have your call as you normally would. Kalara works silently in the background. When a question comes up that your documents can answer, the answer will appear as a floating overlay at the top of your screen. You can glance at it or ignore it. It disappears on its own.

---

## 4. Projects — Your Knowledge Base

A **Project** is a named collection of documents that Kalara uses as its source of truth during a call. You might have one Project per major context in your work:

- "Series A Fundraise" — pitch deck, financial model, investor FAQ
- "Enterprise Sales" — product spec, pricing sheet, case studies, objection handling guide
- "Acme Corp Account" — contract notes, past meeting summaries, custom proposal
- "Board Meetings" — company metrics, strategy docs, board materials

### Documents you can upload
- **PDF** — pitch decks, reports, research, contracts
- **Word documents (.docx)** — memos, proposals, specs
- **Plain text (.txt)** — FAQs, notes, raw data
- **Markdown (.md)** — technical documentation, knowledge bases

There is no limit on the number of projects or documents. Upload everything that might be relevant to a context and Kalara will search across all of it in real time.

### Two document layers

Kalara supports two distinct layers of documents during a call:

**Foundation documents** are the permanent documents in a Project — your pitch deck, financial model, product spec. These are always loaded and form the core knowledge base.

**Call-specific documents** are temporary files you upload for just that one session — a custom slide deck for a specific investor, a proposal tailored to one client, a competitor teardown for a specific deal. These are the highest priority during the call and are cleared when the session ends.

This layered approach means you have a stable base of knowledge that gets augmented with call-specific material without ever polluting your permanent document library.

### Managing Projects
Open the **Manage Projects** window from the tray menu. From here you can:
- Create new Projects
- Delete Projects (and all their documents)
- Upload new documents via drag-and-drop or file picker
- Remove individual documents
- Preview document contents

---

## 5. Starting a Session — The Recall Setup

The **Recall Setup** window is where you configure a session before a call begins. It takes about 30 seconds to fill out.

### Meeting URL
Paste the video call link from your calendar invite or meeting notification. Kalara supports Google Meet, Zoom, Microsoft Teams, and any other standard video conferencing URL.

### Project Selection
Choose which Project's documents Kalara should use for this call. You can switch Projects mid-call if needed (see Participant Auto-Detection).

### The Call Brief
Write a short free-text brief about the call — who you're talking to, the context, the goal, any specific tone or positioning you want to use. This is your personal instruction set for Claude. Example:

> "This is a 30-minute intro call with Sarah Chen, a partner at Sequoia. She focuses on fintech and B2B SaaS. She'll likely probe on our go-to-market. Position us as enterprise-first. Be confident on unit economics."

The Brief is the highest-priority input for Kalara. When the AI formulates an answer, the Brief takes precedence over everything else. It shapes not just what Kalara says but how it says it.

### Bot-Only Mode
If you want to send the Kalara bot into a call without joining yourself (e.g., you want to monitor a meeting your team is running, or record a call you'll review later), toggle **Bot Only**. The bot will join, listen, and transcribe — but Kalara will not try to open the meeting link on your computer.

### Pre-Call Web Research
If web search is enabled in Settings, you can have Kalara run a pre-call research pass before the meeting starts. Based on your Brief, it will search the web for relevant context and add it to the live knowledge base for that call.

### Starting the Session
Click **Start Session**. Kalara sends the bot to the meeting and begins listening within 10–20 seconds. An auto-join toast notification confirms the bot has entered.

---

## 6. The Live Answer Overlay

The answer overlay — called the **Topbar** — is a slim, frameless floating bar that appears at the very top of your screen whenever Kalara has an answer to surface.

### How answers are triggered
Kalara monitors the live transcript continuously. When it detects a sentence that sounds like a question — based on phrasing, question marks, and conversational signals — it runs a search against your documents. If the documents contain relevant information, Claude generates a 2–3 sentence answer and the overlay appears.

### What you see
The overlay shows:
- **The answer text** — concise and direct, 2–3 sentences
- **A confidence indicator** — green means the answer is well-supported by your documents; amber means it's a partial match
- **Source labels** — which document(s) the answer came from
- **Feedback buttons** — thumbs up / thumbs down to rate the answer quality

### Auto-dismiss
The overlay disappears automatically after a configurable amount of time (default: 12 seconds). You can set this from 5 seconds to 30 seconds in Settings. If you're in Awareness Mode (sidebar), answers stay visible in the sidebar history.

### Feedback
Clicking thumbs-up or thumbs-down on an answer does two things: it logs your rating, and it adjusts how Kalara scores future chunks from that document. Over time, Kalara learns which parts of your documents are most useful in conversation.

### Participant notification (amber bar)
When Kalara detects a participant whose email matches someone from a previous call, an amber notification bar appears at the top of the overlay. It tells you which Project it's suggesting (based on your call history with that person) and gives you three options:
- **Keep** — stay on the current Project
- **Switch** — switch to the suggested Project
- **Undo** — revert to the previous Project if you've already switched

This makes Kalara proactively context-aware, automatically loading the right documents for the person you're talking to.

---

## 7. Awareness Mode — The Sidebar

**Awareness Mode** transforms Kalara from a passive overlay into a persistent co-pilot panel on the right side of your screen. Instead of a brief flash at the top, answers accumulate in a scrollable history panel you can reference throughout the call.

### What the sidebar shows

**Answers tab:**
All AI-generated answers from the current call, in order, each with the original question, the answer text, confidence level, and document source. You can rate each answer with thumbs up/down. The most recent answer is always at the top.

**Coaching tab:**
Real-time coaching nudges based on the conversation (see Coaching section). Tips about pace, clarity, objection handling, or deal signals.

**Manual query field:**
At the bottom of the sidebar is a text input where you can type a question manually at any time — even if it wasn't asked out loud in the meeting. Kalara searches your documents and returns an answer instantly. Useful when you want to look something up proactively before you're asked.

**Participant avatars:**
A collapsible strip at the top of the sidebar shows avatar icons for everyone on the call. Avatars are pulled from Gravatar using email addresses when available.

**Engagement score:**
A real-time score (0–100) with a sparkline trend chart showing how engaged the call is based on conversational signals. Drops in engagement can be an early signal to change approach.

### Switching to Awareness Mode
From the tray menu, select **Awareness Mode**. The sidebar slides in from the right side of your screen. You can collapse it to a narrow strip when you need more screen space — collapsing shows just the avatar icons and maintains context.

---

## 8. Eyeline Mode — The Floating Pill

**Eyeline Mode** is designed for situations where even the sidebar feels like too much — high-stakes presentations, video interviews, or any call where you need your eyes clearly on camera, not tracking a panel.

The Eyeline pill is a small, compact widget that floats in the corner of your screen. It's designed to sit just below your webcam so that glancing at it looks like you're maintaining eye contact rather than looking away.

### What the pill shows
- A short excerpt of the latest answer (1–2 lines by default)
- A confidence color dot
- A Size toggle (S/L) to expand to 4 lines when needed
- Thumbs up/down for feedback

### Behavior modes
- **Passive** — the pill only appears when there's a new answer; otherwise invisible
- **Always Visible** — the pill stays on screen semi-transparently, showing the last answer or current transcript
- **Always Transcript** — the pill continuously shows the live transcript instead of answers, so you can always see what's being picked up

### Expanding an answer
Click or tap the pill to expand it for more detail. The full answer appears in a slightly larger view. It auto-collapses after a few seconds or on next interaction.

### Switching to Eyeline Mode
From the tray menu, select **Eyeline Mode**. Coaching nudges also appear in the Eyeline pill when in this mode.

---

## 9. The Call Brief

The **Call Brief** is one of Kalara's most powerful and underused features. It is a free-text instruction set you write at session start that shapes everything Claude says during the call.

### What it can do
The Brief is injected as the highest-priority system instruction to Claude on every answer. This means you can use it to:

**Control tone and framing:**
> "Be confident and direct. Avoid hedging language. Never say 'I think' or 'approximately.'"

**Set competitive positioning:**
> "If asked about competitors, always lead with our unique advantage on multi-currency support. Never disparage competitors directly."

**Provide context Claude wouldn't have:**
> "This investor previously backed FinanceFlow (our competitor). They will probe on differentiation aggressively."

**Give specific instructions for this call:**
> "We are trying to get to a term sheet. Focus on growth metrics and team strength. If they ask about burn, emphasize 18-month runway."

**Define key numbers or facts:**
> "ARR: $2.4M. MoM growth: 12%. NPS: 67. Logo retention: 94%."

The Brief overrides document content when there's a conflict and shapes how Claude frames every answer — not just what it says but how it says it. Think of it as pre-briefing your AI assistant the same way you'd brief a human colleague before a big meeting.

---

## 10. Calendar Integration & Auto-Join

When you connect your Google account, Kalara reads your upcoming calendar and builds a list of meetings that have video call links.

### What Kalara does with your calendar

**Upcoming meetings in the tray menu:**
The tray menu shows your next few meetings with their titles, start times, and whether they have a call link. You can initiate a session directly from this list without opening any other window.

**Meeting alerts:**
For meetings starting within 15 minutes, Kalara shows a pop-up alert card in the corner of your screen (see Meeting Alerts section).

**Auto-Join:**
If enabled in Settings, Kalara automatically sends a bot to meetings that are about to start — without you having to do anything. You configure how many minutes before the meeting start time Kalara should auto-join (default: 2 minutes).

### Smart project assignment on auto-join
When Kalara auto-joins a meeting, it tries to figure out which Project to load automatically. It looks at the organizer's email address, checks your call history, and selects the Project you most frequently used with that person. If it can't find a match, it starts with no Project and waits for participant auto-detection (see Section 12) to identify the right one when someone joins.

This means recurring meetings — weekly 1:1s, ongoing investor relationships, regular customer calls — automatically load the right context without you doing anything.

### Calendar event ID tracking
Kalara stores the Google Calendar event ID with each call record. This means the call history for a recurring meeting is linked to the calendar series, making it easy to trace the history of a relationship over time.

---

## 11. Meeting Alerts

When a meeting with a video call link is 15 minutes away, Kalara shows a **Meeting Alert** card in the bottom-right corner of your screen.

The alert shows:
- The meeting title
- The organizer's name and avatar (from Gravatar)
- Time until the meeting starts, live countdown ("In 8 min")
- A progress bar that fills as the meeting approaches

### Actions on the alert

**Join** — Opens the meeting link in your browser and starts a full Kalara session (you and the bot).

**Send Bot Only** — Sends the Kalara bot to the meeting without you joining (bot-only mode). Useful if you're running late or want the meeting recorded/transcribed while you're still in another call.

**Snooze** — Dismisses the alert for 5 minutes, then shows it again.

**Copy Link** — Copies the meeting URL to your clipboard.

**Project assignment** — If Kalara has suggested a Project (based on your history with the organizer), you can confirm or change it before sending the bot.

The alert auto-dismisses after 60 seconds if you don't interact with it.

---

## 12. Participant Auto-Detection

Kalara watches who joins the call in real time. When a participant joins with a recognized email address — someone you've spoken to before — Kalara looks up which Project you used most often with that person and suggests switching to it.

### How it works

1. A participant joins the call. Recall sends Kalara their name and email.
2. Kalara checks your call history across all Projects for that email.
3. If there's a match, Kalara identifies the most frequently associated Project.
4. If that Project is different from the currently loaded one, an amber notification banner appears at the top of the answer overlay.
5. The banner shows: **"Switching to [Project Name] based on [Participant Name]'s call history"** with Keep / Undo / Switch buttons.

### Why this matters
In practice, this means Kalara becomes a self-organizing system. You don't need to remember which Project to load for each call — Kalara figures it out from your history. An investor you've spoken to three times before will automatically load your fundraise Project. A customer you demo regularly will automatically load your product Project.

### Speaker attribution
Kalara maps participants to their display names rather than generic labels like "Speaker 1." When participant names are available (from Recall.ai's participant data), they're used in the transcript and stored in call history. When a participant has a generic label but a known email address, Kalara uses the email's local part (the part before the @) as a fallback name. This makes transcripts and summaries readable rather than full of anonymous speaker labels.

---

## 13. Coaching & Engagement Intelligence

Kalara includes two separate real-time intelligence layers that operate throughout the call independently of the answer engine.

### Coaching nudges

The coaching system monitors the live conversation and surfaces brief, actionable tips based on what's happening. These appear as short notifications in the answer overlay (or Eyeline pill) with a distinct amber color.

Examples of coaching nudges:
- "You've been talking for 3 minutes straight — invite a response"
- "Deal signal detected: they asked about implementation timeline"
- "Objection: pricing concern — consider anchoring on ROI"
- "Engagement drop — try a direct question"

Coaching nudges are separate from document answers. They are based on conversational patterns, not your documents. You can configure the sensitivity of coaching in Settings — how frequently it fires, which categories of nudges you want, and whether to show them in the overlay, sidebar, or Eyeline pill.

### Engagement score

The engagement score is a continuous 0–100 signal shown in the sidebar. It's calculated from conversational signals — response length, question frequency, back-and-forth balance, and participation patterns. A high score means the conversation is flowing well. A dropping score can be an early signal that you're losing the room and should change approach.

The sidebar shows the current score plus a sparkline chart of how it has trended over the call. This gives you an at-a-glance read on call momentum without requiring any manual input.

---

## 14. Web Search Intelligence

Beyond your own documents, Kalara can search the internet to answer questions your documents don't cover.

### Live web search
When enabled, if Kalara detects a question during a call but can't find a good answer in your documents, it falls back to a real-time web search using Claude's built-in web search capability. The answer is labeled as coming "from the web" rather than from your documents, so you always know the source.

Live web search has configurable quality levels — you can prefer faster results or higher-quality answers depending on your call dynamics.

### Pre-call web research
Before starting a session, you can trigger a **Prepare** step that runs web research based on your Call Brief. Kalara searches the web for information relevant to the people you're about to meet — company background, recent news, relevant market data — and adds this as a pre-loaded context layer for the call. This context is labeled as "PRE-CALL WEB RESEARCH" in the answer prompt so Claude uses it appropriately.

### Post-call web review
For questions that came up during the call but couldn't be answered in real time — either because your documents didn't have the answer or because the question was complex — Kalara queues them for a post-call web research pass.

After the session ends, Kalara searches the web for answers to these unanswered questions in the background. A notification tells you when the results are ready. You can then open the **Post-Call Review** window, read the web-sourced answers, and save the best ones directly to your Project as new documents — so the same question gets answered immediately next time.

---

## 15. Post-Call Memory & Learning

This is what makes Kalara get smarter over time rather than being a static tool. After every call, Kalara saves a permanent record that it uses to enrich future calls with the same participants.

### What gets saved

**Full transcript** (`{callId}.json`):
Every utterance from the call — speaker name, spoken text, and timestamp — saved in structured format. This is the permanent record of the conversation.

**AI-generated summary** (`{callId}-summary.json`):
If the call lasted long enough to be meaningful (10 or more utterances), Kalara sends the full transcript to Claude Haiku and generates a 3–5 sentence summary covering: main topics discussed, key decisions made, action items, and any commitments or agreements. This summary is what gets injected as context in future calls — not the full transcript — keeping the prompt efficient.

**Call history index** (`call-history-index.json`):
A fast-lookup index stored per Project. Lists all calls with date, participants, meeting title, and a brief excerpt. This is what Kalara scans when loading context for a new call.

### The bot-left toast and "View Summary"
When a session ends — either because the bot detected the call ended, you ended it manually, or the 60-second countdown after you leave expired — a toast notification appears in the bottom-right corner of your screen.

The toast says **"Kalara left · [Meeting Name]"** and has two buttons:
- **View Summary** — Opens the AI-generated summary in a clean readable window. Initially shows a spinner while the summary is being generated (the AI call happens in the background). The button becomes active within a minute of the call ending. Click it to see the full summary: meeting title, date, duration, participants, and the AI-written narrative.
- **Dismiss** — Closes the toast.

### Cross-call context injection

On your next call with the same participants, Kalara automatically loads relevant summaries from past calls and injects them into Claude's context — at the lowest priority level, after your documents and Brief.

This appears in Claude's prompting as labeled blocks:

> **PAST CALL CONTEXT: From Series A Fundraise / Mar 4, 2026 with Sarah Chen, Mike Tanaka:**
> The call focused on go-to-market strategy and competitive differentiation. Sarah asked specifically about multi-currency support and the enterprise vs. SMB segmentation. Key decision: they want a follow-up with the CTO to discuss API architecture. Action item: send technical spec doc by end of week.

When a question comes up in the new call that was discussed previously, Kalara's answers will explicitly reference the prior conversation: *"As discussed on March 4th with Sarah and Mike, we agreed that the API architecture question would be answered at the follow-up..."* This kind of continuity is something no human sales rep or founder can reliably maintain across every relationship — Kalara does it automatically.

The context search runs across **all** your Projects — if a participant has appeared in calls from multiple Projects, Kalara retrieves relevant history from all of them. The search happens once at the beginning of the first question on each call and is refreshed automatically if a new participant joins mid-call.

---

## 16. Session Management & Multi-Session

### Single sessions
A session is the period from when you start the Recall bot to when you end it. During a session, Kalara is listening, answering, and accumulating transcript data.

### Ending a session
Sessions end in several ways:
- **Manually** — Click End Session in the tray menu
- **Bot exit** — When the video call platform closes or everyone leaves, Recall's bot detects this and signals Kalara to end the session automatically
- **Auto-end after you leave** — When Kalara detects that your email address left the call (via participant events), it shows a 60-second countdown toast. If you don't click "Keep Active," the session ends when the timer runs out. This handles the common case where you close the meeting window but forget to end the session.

### Multi-session (up to 3 concurrent)
Kalara supports running up to three simultaneous sessions — for example, if you're monitoring three calls at once, or have a bot in a meeting while you're actively in a different one. Each session is completely independent with its own documents, transcript, answer log, and call history.

When multiple sessions are active:
- The tray menu shows the number of active sessions
- Ending a session shows a picker so you can choose which one to end
- Each session tracks its own participants, suggestions, and history independently

### Bot-only sessions
In bot-only mode, Kalara joins the call without you. No answer overlays appear on your screen. The bot still listens and transcribes the full call, and the post-call summary and transcript are saved normally. This is useful for:
- Recording and transcribing calls run by your team
- Monitoring calls you'll review asynchronously
- Getting a searchable record of meetings you can only partially attend

---

## 17. The Tray Menu

The **Tray Menu** is Kalara's home base — a compact popup that appears when you click the Kalara icon in your Mac menubar. Everything you need to manage Kalara is accessible here.

### Account section
- If signed in with Google: shows your profile photo, name, and email with a Settings button
- If not signed in: shows a "Connect Google Calendar" button
- Google sign-in enables calendar integration and auto-join

### Upcoming meetings
A list of your next few Google Calendar meetings with video call links, showing:
- Meeting title
- Start time (relative: "In 12 min", "Starts now", "In 2h")
- A green pulse dot for sessions currently active in that meeting
- A purple pulse dot for bot-only sessions

Click any meeting to start a session for it directly.

### Mode switcher
Three modes, select one:
- **Passive** — Only the topbar overlay. Minimal footprint, just flashes answers briefly.
- **Awareness Mode** — Full sidebar panel on the right side of your screen.
- **Eyeline Mode** — Floating pill in the corner for maximum eye-contact.

### Session controls
- **Start Session** — Opens the Recall Setup window to begin a new session
- **End Session** — Ends the current session (shows a picker if multiple sessions are active)
- **Manage Projects** — Opens the Projects window

### Other controls
- **Settings** — Opens the full Settings panel
- **Quit** — Exits Kalara completely

---

## 18. Settings & Customization

The **Settings** window has five sections:

### General
- **Bot name** — The name the Recall bot uses when it joins a meeting. Defaults to "[Your First Name]'s Notetaker." You can set it to anything — "Note Taker," your company name, your assistant's name.
- **Hotkey** — Keyboard shortcut to trigger a manual Spotlight query at any time (default: Cmd+Shift+Space)
- **Dismiss hotkey** — Keyboard shortcut to immediately dismiss the current answer overlay (default: Escape)
- **Auto-join** — Toggle automatic meeting joining on/off, and set how many minutes before meeting start Kalara should join (1–10 minutes)
- **Theme** — Dark mode or light mode

### Display
- **Show confidence scores** — Whether to show the green/amber confidence indicator on answers
- **Answer auto-dismiss** — How long (in seconds) the answer overlay stays visible before disappearing (5–30 seconds)

### Intelligence
- **Live web search** — Enable/disable real-time web search fallback during calls
- **Web search quality** — Best Match (faster) vs. High Quality (more thorough but slower)
- **Pre-call research** — Enable/disable the pre-call web research preparation step
- **Post-call research** — Enable/disable the background post-call web search pass

### Coaching
- **Coaching enabled** — Master toggle for all coaching nudges
- **Coaching sensitivity** — How frequently and aggressively coaching nudges fire
- **Coaching categories** — Which types of nudges you want: pace, deal signals, objection detection, etc.

### Engagement
- **Engagement scoring** — Toggle the real-time engagement score on/off
- **Engagement sensitivity** — Tune how the engagement score is calculated

### Eyeline behavior
- **Passive** — Pill only appears when there's a new answer
- **Always visible** — Pill stays on screen semi-transparently
- **Always transcript** — Pill shows the live transcript continuously

### Account
- **Google account** — Connect or disconnect Google Calendar
- View your connected profile, name, and email

---

## 19. Data Storage & Privacy

### All data stays on your machine
Kalara does not have a cloud backend or central server. All your documents, transcripts, summaries, and call history are stored locally on your Mac in the application's data directory. Nothing is synced to an external service.

### What leaves your machine
Three things leave your Mac:
1. **Recall.ai** receives the meeting URL to send the bot. Recall handles the audio/video processing and sends back transcript events. Recall is a separate service with its own privacy policy.
2. **Anthropic (Claude)** receives text prompts containing transcript excerpts and document chunks to generate answers, and transcript text to generate post-call summaries. No audio or video is ever sent to Anthropic — only text.
3. **Google** receives OAuth authentication requests to read your calendar. Only calendar metadata (meeting titles, times, links) is read.

### File structure on disk
```
docs/
  projects.json                          ← list of all project names and IDs
  call-history.json                      ← global call log (for project suggestion)
  config.json                            ← app settings and Google auth tokens
  projects/
    {project-id}/
      manifest.json                      ← list of uploaded documents
      uploads/                           ← the actual document files
      call-history/
        {callId}.json                    ← full transcript for each call
        {callId}-summary.json            ← AI-generated summary for each call
        call-history-index.json          ← fast index of all calls in this project
    unassigned/
      call-history/                      ← transcripts for calls with no project
```

### Your documents are never shared
Documents you upload to Kalara are stored locally and sent to Claude only in chunks that are relevant to the specific question being asked in real time — not as a bulk upload to any external service. Only the fragments needed to answer a given question leave your machine, and only for that request.

---

## Quick Reference — Everything Kalara Can Do

| Feature | What it does |
|---|---|
| **Real-time answers** | Detects questions in the call transcript and surfaces answers from your docs as a screen overlay |
| **Projects** | Named collections of documents (PDF, Word, TXT, MD) as your knowledge base |
| **Call Brief** | Free-text instructions that shape how Claude frames every answer |
| **Foundation + Call docs** | Permanent project docs + temporary call-specific docs, layered |
| **Answer overlay (Topbar)** | Full-width floating bar at the top of your screen with answers, confidence, source |
| **Awareness Mode** | Right-side panel with answer history, manual query, live transcript |
| **Eyeline Mode** | Compact floating pill near your webcam for eye-contact-preserving glances |
| **Google Calendar** | Reads upcoming meetings, shows them in tray, enables auto-join |
| **Auto-Join** | Automatically sends bot to meetings N minutes before they start |
| **Meeting alerts** | Pop-up card 15 min before a meeting: Join, Send Bot, Snooze |
| **Participant auto-detection** | Recognizes known emails joining a call and suggests switching to the right Project |
| **Speaker attribution** | Maps participant IDs to real names in transcripts and history |
| **Coaching nudges** | Real-time tips on call dynamics, pace, deal signals, objection handling |
| **Engagement score** | 0–100 live signal of call engagement with sparkline trend |
| **Live web search** | Falls back to internet search when docs can't answer a question |
| **Pre-call research** | Runs web research before the call based on your Brief |
| **Post-call research** | Searches the web after the call for questions that went unanswered |
| **Full transcript save** | Saves every utterance with speaker name and timestamp |
| **AI call summary** | Claude Haiku-generated 3–5 sentence summary of each call |
| **Cross-call context** | Injects relevant history from past calls with the same participants into live answers |
| **Bot-left toast** | Notifies you when a session ends; View Summary button opens the AI summary |
| **Call summary viewer** | Clean readable window showing meeting title, duration, participants, AI summary |
| **Multi-session** | Run up to 3 simultaneous bot sessions for different calls |
| **Bot-only mode** | Send the bot without joining yourself — for recording and monitoring |
| **Auto-end detection** | 60-second countdown when you leave a call; auto-ends session unless you keep it |
| **Answer feedback** | Thumbs up/down on answers; adjusts document chunk ranking over time |
| **Manual query (Spotlight)** | Hotkey to ask a question manually at any time, even mid-call |
| **Post-call review** | Window to review and save web-sourced answers from unanswered call questions |
| **Tray menu** | Central control hub: mode switch, session control, meetings list, quick actions |
| **Settings** | Full configuration for all behavior, hotkeys, display, coaching, web search, account |

---

*Kalara is built on Electron (macOS), Express.js, Recall.ai for meeting transcription, and Anthropic's Claude for AI-generated answers and summaries.*
