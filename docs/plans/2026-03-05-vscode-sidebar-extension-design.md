# VS Code Sidebar Extension Enhancement Design

**Goal:** Transform the minimal file-watcher extension into a full sidebar webview with playback controls, TTS audio, walkthrough navigation, and bidirectional communication with Claude.

**Architecture:** Extension runs a WebSocket server. Claude connects as a WS client to send walkthrough plans and receive user actions. Extension handles playback autonomously. TTS audio streams from the existing tts_server.py through the extension's Node.js backend into the webview via Web Audio API.

---

## 1. Extension Architecture

```
VS Code Extension (Node.js backend)
│
├── 1. WebSocket Server (localhost:dynamic-port)
│   ├── Accepts Claude as a WS client
│   ├── Receives: plan data, segment mutations, TTS text
│   ├── Sends: user actions, current state
│   └── Port written to ~/.claude-explainer-port for discovery
│
├── 2. TTS Audio Bridge
│   ├── Connects to tts_server.py via Unix socket (/tmp/tts-server.sock)
│   ├── Receives streamed float32 PCM chunks
│   ├── Encodes each chunk as base64, sends to webview via postMessage
│   └── Webview plays via Web Audio API (24kHz, mono, float32)
│
├── 3. Webview Sidebar Panel
│   ├── Walkthrough outline (clickable segments)
│   ├── Playback controls (play/pause, prev/next, speed)
│   ├── Volume control + mute toggle
│   ├── Voice selector dropdown
│   ├── Explanation text panel (markdown rendered)
│   ├── Progress indicator (segment N of M)
│   └── "Go deeper" / "Zoom out" buttons
│
└── 4. Highlight Manager (existing, enhanced)
    ├── Driven by sidebar state (no file-watcher delay)
    └── File-watcher remains as fallback for backward compatibility
```

---

## 2. WebSocket Protocol

All messages are JSON over WebSocket.

### Claude → Extension

```jsonc
// Initial plan
{
  "type": "set_plan",
  "title": "Authentication Flow",
  "segments": [
    {
      "id": 1,
      "file": "/path/to/auth.ts",
      "start": 10,
      "end": 25,
      "title": "Token validation",
      "explanation": "This function validates the auth token...",
      "ttsText": "This function validates the auth token by calling getToken and redirecting if invalid."
    }
  ]
}

// Plan mutations
{"type": "insert_after", "afterSegment": 3, "segments": [...]}
{"type": "replace_segment", "id": 5, "segment": {...}}
{"type": "remove_segments", "ids": [6, 7]}

// Control
{"type": "goto", "segmentId": 3}
{"type": "resume"}
{"type": "stop"}
```

### Extension → Claude

```jsonc
// State updates (sent on every state change)
{
  "type": "state",
  "currentSegment": 3,
  "status": "playing" | "paused" | "stopped",
  "totalSegments": 8
}

// User actions requiring Claude's AI
{"type": "user_action", "action": "go_deeper", "segmentId": 3}
{"type": "user_action", "action": "zoom_out", "segmentId": 3}
{"type": "user_action", "action": "ask_question", "segmentId": 3, "question": "Why not use JWT here?"}
```

Claude only needs to react to `user_action` messages. State messages are informational — Claude reads them when it needs context.

---

## 3. TTS Audio Flow

```
Claude sends segment with ttsText
    ↓
Extension Node.js backend
    ↓ connects to /tmp/tts-server.sock (Unix socket)
    ↓ sends {"text": "...", "voice": "af_heart", "speed": 1.0}
    ↓ receives streamed float32 PCM chunks (4-byte length header + data)
    ↓
Encodes each chunk as base64, sends to webview via postMessage:
    {type: "audio_chunk", data: "<base64>", sampleRate: 24000}
    {type: "audio_end"}
    ↓
Webview (Web Audio API)
    ↓ decodes base64 → Float32Array
    ↓ creates AudioBuffer, queues into AudioBufferSourceNode
    ↓ plays each chunk as it arrives (streaming playback)
```

### TTS Controls

- **Play/Pause** — pause mid-sentence, resume from where it stopped
- **Volume** — GainNode in Web Audio graph
- **Speed** — hybrid approach:
  - Model-level speed for initial generation (natural sounding)
  - Web Audio playbackRate for instant fine-tuning on top
  - User changes speed → applies immediately via playbackRate, next segment generates at new model speed
- **Voice** — dropdown selector, applies from next segment onward
- **Mute/Unmute** — quick toggle without losing volume level

### Interruption

When user clicks "next" or "skip", extension closes the Unix socket connection mid-stream. tts_server.py handles `BrokenPipeError` gracefully already. Web Audio queue is flushed.

---

## 4. Editor Control (Highlighting)

Segment transitions drive editor actions directly — no file I/O, no polling:

```
Segment transition (any speed)
    ↓ immediate, in-process
    ├── Open file (vscode.workspace.openTextDocument)
    ├── Highlight lines (editor.setDecorations)
    ├── Scroll to center (editor.revealRange)
    └── Start TTS audio for this segment
```

Auto-advance: when the last audio chunk's `onended` fires, move to next segment and highlight immediately. Works at any speed.

---

## 5. Sidebar Webview Layout

```
┌─ Code Explainer ─────────────────┐
│                                  │
│  Authentication Flow             │  ← walkthrough title
│                                  │
│  ┌─ Now Playing ──────────────┐  │
│  │ 3/8 · Token Validation     │  │  ← current segment title
│  │ auth.ts:10-25              │  │  ← file + line range (clickable)
│  └────────────────────────────┘  │
│                                  │
│  ⏮  ◀  ⏸  ▶  ⏭               │  ← playback controls
│  ━━━━━━━●━━━━━━━━━━━━━━━━━━━  │  ← segment progress bar
│                                  │
│  🔊 ━━━━━●━━━  [1.5x]  🎙▾    │  ← volume, speed, voice
│                                  │
│  ┌─ Explanation ──────────────┐  │
│  │ This function validates    │  │
│  │ the authentication token   │  │  ← markdown-rendered
│  │ by calling getToken() and  │  │
│  │ checking if it's valid...  │  │
│  └────────────────────────────┘  │
│                                  │
│  [Go Deeper]  [Zoom Out]        │  ← sends user_action to Claude
│                                  │
│  ┌─ Outline ──────────────────┐  │
│  │ ✓ 1. Project setup         │  │
│  │ ✓ 2. Initialization        │  │
│  │ ▶ 3. Token validation      │  │  ← current (highlighted)
│  │ ○ 4. Route guards          │  │
│  │ ○ 5. Session management    │  │  ← all clickable to jump
│  │ ○ 6. Error handling        │  │
│  │ ○ 7. Middleware chain      │  │
│  │ ○ 8. Integration tests     │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

---

## 6. Connection Lifecycle & Error Handling

### Lifecycle

1. **Startup** — Extension activates, starts WS server on random port, writes port to `~/.claude-explainer-port`. Sidebar shows idle state. File-watcher fallback still active.

2. **Walkthrough start** — Claude reads port, connects via WS, sends `set_plan`. Extension opens sidebar, renders outline, begins first segment.

3. **During walkthrough** — Extension plays autonomously (auto-advance on audio end). User can pause, skip, jump, change speed/voice/volume. Claude can push mutations.

4. **Interruption** — User pauses from sidebar, types question in Claude terminal. Claude reads state, answers contextually, optionally pushes new segments, sends `resume`.

5. **Walkthrough end** — Last segment finishes or Claude sends `stop`. Sidebar shows completion summary. WebSocket closes.

### Error resilience (graceful degradation)

- **Claude disconnects mid-walkthrough** → Sidebar shows "Disconnected". User can still navigate all loaded segments. TTS continues (extension talks to tts_server directly).
- **tts_server not running** → Extension falls back to no-audio mode. Explanation text and highlights still work.
- **Port file missing** → Claude falls back to file-watcher highlight protocol.
- **Extension not updated** → Old file-watcher protocol still works.

---

## 7. Technology

- **WebSocket:** `ws` npm package (Node.js backend)
- **Webview:** VS Code Webview API with `ViewColumn.Beside` or sidebar `WebviewViewProvider`
- **Audio:** Web Audio API (AudioContext, AudioBufferSourceNode, GainNode)
- **TTS bridge:** Node.js `net` module connecting to Unix socket
- **Markdown rendering:** Simple HTML conversion in webview (or lightweight lib)
