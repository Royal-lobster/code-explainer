# VS Code Sidebar Extension Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the file-watcher extension into a sidebar webview with playback controls, streaming TTS audio via Web Audio API, walkthrough navigation, and bidirectional HTTP+WebSocket communication with Claude.

**Architecture:** Extension runs an HTTP+WS server on a dynamic port. Claude sends walkthrough plans and mutations via HTTP (curl). Extension plays autonomously — highlighting code, streaming TTS audio through the webview, and handling navigation. User actions (go deeper, zoom out) are sent back to Claude via long-poll endpoint.

**Tech Stack:** TypeScript, VS Code Webview API, `ws` (WebSocket), Web Audio API, Node.js `net` (Unix socket for TTS bridge), `esbuild` (bundler)

---

### Task 1: Update project setup

**Files:**
- Modify: `vscode-extension/package.json`
- Modify: `vscode-extension/.vscodeignore`
- Create: `vscode-extension/media/` (directory)

**Step 1: Update `package.json`**

```json
{
	"name": "code-explainer",
	"displayName": "Code Explainer",
	"description": "Interactive code walkthroughs with AI-powered voice narration and editor highlighting.",
	"version": "0.2.0",
	"publisher": "srujangurram",
	"engines": {
		"vscode": "^1.85.0"
	},
	"categories": ["Other"],
	"activationEvents": ["*"],
	"main": "./out/extension.js",
	"contributes": {
		"viewsContainers": {
			"activitybar": [
				{
					"id": "code-explainer",
					"title": "Code Explainer",
					"icon": "media/icon.svg"
				}
			]
		},
		"views": {
			"code-explainer": [
				{
					"type": "webview",
					"id": "codeExplainer.sidebar",
					"name": "Code Explainer"
				}
			]
		}
	},
	"scripts": {
		"compile": "esbuild src/extension.ts --bundle --platform=node --target=node18 --outfile=out/extension.js --external:vscode --format=cjs --sourcemap",
		"watch": "npm run compile -- --watch",
		"package": "npm run compile -- --minify && vsce package --no-dependencies"
	},
	"dependencies": {
		"ws": "^8.16.0"
	},
	"devDependencies": {
		"@types/node": "^20.11.0",
		"@types/vscode": "^1.85.0",
		"@types/ws": "^8.5.0",
		"esbuild": "^0.20.0",
		"typescript": "^5.3.0"
	}
}
```

**Step 2: Update `.vscodeignore`**

```
.vscode/**
node_modules/**
src/**
tsconfig.json
package-lock.json
**/*.ts
**/*.map
.gitignore
```

**Step 3: Create media directory**

```bash
mkdir -p vscode-extension/media
```

**Step 4: Install dependencies**

```bash
cd vscode-extension && npm install
```

**Step 5: Verify esbuild works**

```bash
cd vscode-extension && npx esbuild --version
```

Expected: Prints esbuild version.

**Step 6: Commit**

```bash
git add vscode-extension/package.json vscode-extension/.vscodeignore vscode-extension/package-lock.json
git commit -m "build: add ws, esbuild, sidebar view container config"
```

---

### Task 2: Create shared protocol types

**Files:**
- Create: `vscode-extension/src/types.ts`

**Step 1: Write `types.ts`**

```typescript
// ── Walkthrough data ──

export interface Segment {
	id: number;
	file: string;
	start: number;
	end: number;
	title: string;
	explanation: string;
	ttsText: string;
}

// ── Claude → Extension messages (HTTP + WS) ──

export interface SetPlanMessage {
	type: "set_plan";
	title: string;
	segments: Segment[];
}

export interface InsertAfterMessage {
	type: "insert_after";
	afterSegment: number;
	segments: Segment[];
}

export interface ReplaceSegmentMessage {
	type: "replace_segment";
	id: number;
	segment: Segment;
}

export interface RemoveSegmentsMessage {
	type: "remove_segments";
	ids: number[];
}

export interface GotoMessage {
	type: "goto";
	segmentId: number;
}

export interface ResumeMessage {
	type: "resume";
}

export interface StopMessage {
	type: "stop";
}

export type ClaudeMessage =
	| SetPlanMessage
	| InsertAfterMessage
	| ReplaceSegmentMessage
	| RemoveSegmentsMessage
	| GotoMessage
	| ResumeMessage
	| StopMessage;

// ── Extension → Claude messages ──

export type WalkthroughStatus = "playing" | "paused" | "stopped" | "idle";

export interface StateMessage {
	type: "state";
	currentSegment: number;
	status: WalkthroughStatus;
	totalSegments: number;
}

export interface UserActionMessage {
	type: "user_action";
	action: "go_deeper" | "zoom_out" | "ask_question";
	segmentId: number;
	question?: string;
}

export type ExtensionMessage = StateMessage | UserActionMessage;

// ── Extension ↔ Webview messages ──

export interface WebviewUpdateMessage {
	type: "update";
	title: string;
	segments: Segment[];
	currentSegment: number;
	status: WalkthroughStatus;
}

export interface WebviewAudioChunkMessage {
	type: "audio_chunk";
	data: string; // base64-encoded float32 PCM
	sampleRate: number;
}

export interface WebviewAudioEndMessage {
	type: "audio_end";
}

export interface WebviewAudioStopMessage {
	type: "audio_stop";
}

export type ToWebviewMessage =
	| WebviewUpdateMessage
	| WebviewAudioChunkMessage
	| WebviewAudioEndMessage
	| WebviewAudioStopMessage;

export interface WebviewPlayPauseMessage {
	type: "play_pause";
}

export interface WebviewNextMessage {
	type: "next";
}

export interface WebviewPrevMessage {
	type: "prev";
}

export interface WebviewGotoSegmentMessage {
	type: "goto_segment";
	segmentId: number;
}

export interface WebviewGoDeeperMessage {
	type: "go_deeper";
}

export interface WebviewZoomOutMessage {
	type: "zoom_out";
}

export interface WebviewSpeedChangeMessage {
	type: "speed_change";
	speed: number;
}

export interface WebviewVolumeChangeMessage {
	type: "volume_change";
	volume: number;
}

export interface WebviewVoiceChangeMessage {
	type: "voice_change";
	voice: string;
}

export interface WebviewMuteToggleMessage {
	type: "mute_toggle";
}

export type FromWebviewMessage =
	| WebviewPlayPauseMessage
	| WebviewNextMessage
	| WebviewPrevMessage
	| WebviewGotoSegmentMessage
	| WebviewGoDeeperMessage
	| WebviewZoomOutMessage
	| WebviewSpeedChangeMessage
	| WebviewVolumeChangeMessage
	| WebviewVoiceChangeMessage
	| WebviewMuteToggleMessage;
```

**Step 2: Verify it compiles**

```bash
cd vscode-extension && npx tsc --noEmit src/types.ts
```

Expected: No errors.

**Step 3: Commit**

```bash
git add vscode-extension/src/types.ts
git commit -m "feat: add shared protocol types for sidebar communication"
```

---

### Task 3: Extract highlight manager

**Files:**
- Create: `vscode-extension/src/highlight.ts`

**Step 1: Write `highlight.ts`**

```typescript
import * as vscode from "vscode";

const highlightDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: "rgba(255, 213, 79, 0.18)",
	isWholeLine: true,
	overviewRulerColor: "rgba(255, 213, 79, 0.6)",
	overviewRulerLane: vscode.OverviewRulerLane.Center,
});

export async function highlightRange(
	filePath: string,
	startLine: number,
	endLine: number,
): Promise<void> {
	const zeroStart = Math.max(0, startLine - 1);
	const zeroEnd = Math.max(zeroStart, endLine - 1);

	const uri = vscode.Uri.file(filePath);
	const doc = await vscode.workspace.openTextDocument(uri);
	const editor = await vscode.window.showTextDocument(doc, {
		preview: false,
		preserveFocus: false,
	});

	const startPos = new vscode.Position(zeroStart, 0);
	const endPos = new vscode.Position(zeroEnd, doc.lineAt(zeroEnd).text.length);
	const range = new vscode.Range(startPos, endPos);

	editor.selection = new vscode.Selection(startPos, startPos);
	editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
	editor.setDecorations(highlightDecoration, [range]);
}

export function clearHighlights(): void {
	const editor = vscode.window.activeTextEditor;
	if (editor) {
		editor.setDecorations(highlightDecoration, []);
	}
}

export function disposeHighlights(): void {
	highlightDecoration.dispose();
}
```

**Step 2: Verify it compiles**

```bash
cd vscode-extension && npx tsc --noEmit src/highlight.ts
```

**Step 3: Commit**

```bash
git add vscode-extension/src/highlight.ts
git commit -m "refactor: extract highlight manager into its own module"
```

---

### Task 4: Create walkthrough state manager

**Files:**
- Create: `vscode-extension/src/walkthrough.ts`

**Step 1: Write `walkthrough.ts`**

```typescript
import { EventEmitter } from "events";
import type { Segment, WalkthroughStatus } from "./types";

export interface WalkthroughState {
	title: string;
	segments: Segment[];
	currentIndex: number;
	status: WalkthroughStatus;
}

/**
 * Manages walkthrough plan state, segment navigation, and plan mutations.
 *
 * Events:
 *   "segment"  — fired when current segment changes (arg: Segment)
 *   "plan"     — fired when plan is set or mutated (arg: WalkthroughState)
 *   "status"   — fired when status changes (arg: WalkthroughStatus)
 */
export class Walkthrough extends EventEmitter {
	private state: WalkthroughState = {
		title: "",
		segments: [],
		currentIndex: -1,
		status: "idle",
	};

	getState(): WalkthroughState {
		return { ...this.state };
	}

	getCurrentSegment(): Segment | undefined {
		return this.state.segments[this.state.currentIndex];
	}

	// ── Plan lifecycle ──

	setPlan(title: string, segments: Segment[]): void {
		this.state = { title, segments, currentIndex: 0, status: "playing" };
		this.emit("plan", this.getState());
		this.emit("status", this.state.status);
		if (segments.length > 0) {
			this.emit("segment", segments[0]);
		}
	}

	stop(): void {
		this.state.status = "stopped";
		this.emit("status", this.state.status);
	}

	// ── Navigation ──

	play(): void {
		if (this.state.status === "paused") {
			this.state.status = "playing";
			this.emit("status", this.state.status);
		}
	}

	pause(): void {
		if (this.state.status === "playing") {
			this.state.status = "paused";
			this.emit("status", this.state.status);
		}
	}

	togglePlayPause(): void {
		if (this.state.status === "playing") {
			this.pause();
		} else if (this.state.status === "paused") {
			this.play();
		}
	}

	next(): boolean {
		const nextIdx = this.state.currentIndex + 1;
		if (nextIdx >= this.state.segments.length) {
			this.state.status = "stopped";
			this.emit("status", this.state.status);
			return false;
		}
		this.state.currentIndex = nextIdx;
		this.state.status = "playing";
		this.emit("status", this.state.status);
		this.emit("segment", this.state.segments[nextIdx]);
		return true;
	}

	prev(): boolean {
		const prevIdx = this.state.currentIndex - 1;
		if (prevIdx < 0) return false;
		this.state.currentIndex = prevIdx;
		this.state.status = "playing";
		this.emit("status", this.state.status);
		this.emit("segment", this.state.segments[prevIdx]);
		return true;
	}

	goto(segmentId: number): boolean {
		const idx = this.state.segments.findIndex((s) => s.id === segmentId);
		if (idx === -1) return false;
		this.state.currentIndex = idx;
		this.state.status = "playing";
		this.emit("status", this.state.status);
		this.emit("segment", this.state.segments[idx]);
		return true;
	}

	// ── Plan mutations ──

	insertAfter(afterSegmentId: number, newSegments: Segment[]): void {
		const idx = this.state.segments.findIndex((s) => s.id === afterSegmentId);
		if (idx === -1) return;
		this.state.segments.splice(idx + 1, 0, ...newSegments);
		// Adjust currentIndex if insertion is before current position
		if (idx < this.state.currentIndex) {
			this.state.currentIndex += newSegments.length;
		}
		this.emit("plan", this.getState());
	}

	replaceSegment(id: number, segment: Segment): void {
		const idx = this.state.segments.findIndex((s) => s.id === id);
		if (idx === -1) return;
		this.state.segments[idx] = segment;
		this.emit("plan", this.getState());
		// If replacing the current segment, re-emit it
		if (idx === this.state.currentIndex) {
			this.emit("segment", segment);
		}
	}

	removeSegments(ids: number[]): void {
		const idSet = new Set(ids);
		const currentSegment = this.getCurrentSegment();
		this.state.segments = this.state.segments.filter((s) => !idSet.has(s.id));
		// Try to maintain current segment
		if (currentSegment && !idSet.has(currentSegment.id)) {
			this.state.currentIndex = this.state.segments.findIndex(
				(s) => s.id === currentSegment.id,
			);
		} else {
			this.state.currentIndex = Math.min(
				this.state.currentIndex,
				this.state.segments.length - 1,
			);
		}
		this.emit("plan", this.getState());
	}
}
```

**Step 2: Verify it compiles**

```bash
cd vscode-extension && npx tsc --noEmit src/walkthrough.ts
```

**Step 3: Commit**

```bash
git add vscode-extension/src/walkthrough.ts
git commit -m "feat: add walkthrough state manager with navigation and mutations"
```

---

### Task 5: Create TTS bridge

**Files:**
- Create: `vscode-extension/src/tts-bridge.ts`

**Step 1: Write `tts-bridge.ts`**

This connects to the existing `tts_server.py` via Unix socket, sends TTS requests, and streams audio chunks back as base64 for the webview.

```typescript
import * as net from "net";

const SOCKET_PATH = "/tmp/tts-server.sock";
const SAMPLE_RATE = 24000;

export interface TTSOptions {
	voice: string;
	speed: number;
}

/**
 * Streams TTS audio from the Kokoro server.
 * Calls onChunk with base64-encoded float32 PCM data for each sentence.
 * Calls onEnd when the stream completes.
 * Returns a function to abort the stream.
 */
export function streamTTS(
	text: string,
	options: TTSOptions,
	onChunk: (base64Data: string, sampleRate: number) => void,
	onEnd: () => void,
	onError: (err: Error) => void,
): () => void {
	let aborted = false;

	const conn = net.createConnection(SOCKET_PATH);

	conn.on("connect", () => {
		const request = JSON.stringify({
			text,
			voice: options.voice,
			speed: options.speed,
		});
		conn.end(request, "utf-8");
	});

	let buffer = Buffer.alloc(0);
	let waitingForHeader = true;
	let expectedLength = 0;

	conn.on("data", (data: Buffer) => {
		if (aborted) return;

		buffer = Buffer.concat([buffer, data]);

		// Process all complete messages in the buffer
		while (buffer.length >= 4) {
			if (waitingForHeader) {
				expectedLength = buffer.readUInt32BE(0);
				buffer = buffer.subarray(4);

				if (expectedLength === 0) {
					// End-of-stream marker
					onEnd();
					conn.destroy();
					return;
				}
				waitingForHeader = false;
			}

			if (!waitingForHeader && buffer.length >= expectedLength) {
				const audioBytes = buffer.subarray(0, expectedLength);
				buffer = buffer.subarray(expectedLength);
				waitingForHeader = true;

				// Convert raw bytes to base64
				onChunk(audioBytes.toString("base64"), SAMPLE_RATE);
			} else {
				break; // Need more data
			}
		}
	});

	conn.on("error", (err) => {
		if (!aborted) onError(err);
	});

	conn.on("close", () => {
		// If we didn't get an end marker, still signal end
		if (!aborted && waitingForHeader && buffer.length === 0) {
			onEnd();
		}
	});

	return () => {
		aborted = true;
		conn.destroy();
	};
}

/**
 * Check if the TTS server is available.
 */
export function isTTSAvailable(): boolean {
	try {
		const fs = require("fs");
		return fs.existsSync(SOCKET_PATH);
	} catch {
		return false;
	}
}
```

**Step 2: Verify it compiles**

```bash
cd vscode-extension && npx tsc --noEmit src/tts-bridge.ts
```

**Step 3: Commit**

```bash
git add vscode-extension/src/tts-bridge.ts
git commit -m "feat: add TTS bridge for Unix socket audio streaming"
```

---

### Task 6: Create HTTP + WebSocket server

**Files:**
- Create: `vscode-extension/src/server.ts`

**Step 1: Write `server.ts`**

The server provides HTTP endpoints for Claude (curl-friendly) and a WebSocket for optional persistent connections. Both talk to the same walkthrough state.

```typescript
import * as http from "http";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { WebSocketServer, WebSocket } from "ws";
import type { Walkthrough } from "./walkthrough";
import type { ClaudeMessage, ExtensionMessage, UserActionMessage } from "./types";

const PORT_FILE = path.join(os.homedir(), ".claude-explainer-port");

export class ExplainerServer {
	private httpServer: http.Server;
	private wss: WebSocketServer;
	private walkthrough: Walkthrough;
	private wsClients: Set<WebSocket> = new Set();
	private pendingActions: UserActionMessage[] = [];
	private actionWaiters: Array<(action: UserActionMessage) => void> = [];
	private port = 0;

	constructor(walkthrough: Walkthrough) {
		this.walkthrough = walkthrough;
		this.httpServer = http.createServer(this.handleHttp.bind(this));
		this.wss = new WebSocketServer({ server: this.httpServer });
		this.wss.on("connection", this.handleWs.bind(this));
	}

	async start(): Promise<number> {
		return new Promise((resolve) => {
			this.httpServer.listen(0, "127.0.0.1", () => {
				const addr = this.httpServer.address();
				this.port = typeof addr === "object" && addr ? addr.port : 0;
				fs.writeFileSync(PORT_FILE, String(this.port), "utf-8");
				resolve(this.port);
			});
		});
	}

	stop(): void {
		for (const ws of this.wsClients) ws.close();
		this.wss.close();
		this.httpServer.close();
		try {
			fs.unlinkSync(PORT_FILE);
		} catch {}
	}

	/** Queue a user action for Claude to pick up via long-poll or WS */
	queueAction(action: UserActionMessage): void {
		// If someone is waiting, deliver immediately
		const waiter = this.actionWaiters.shift();
		if (waiter) {
			waiter(action);
		} else {
			this.pendingActions.push(action);
		}
		// Also broadcast to WS clients
		this.broadcastToClients(action);
	}

	/** Send state to all connected WS clients */
	broadcastState(): void {
		const state = this.walkthrough.getState();
		const msg: ExtensionMessage = {
			type: "state",
			currentSegment: state.segments[state.currentIndex]?.id ?? -1,
			status: state.status,
			totalSegments: state.segments.length,
		};
		this.broadcastToClients(msg);
	}

	private broadcastToClients(msg: ExtensionMessage | UserActionMessage): void {
		const json = JSON.stringify(msg);
		for (const ws of this.wsClients) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(json);
			}
		}
	}

	// ── HTTP handler ──

	private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
		res.setHeader("Content-Type", "application/json");
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		const url = new URL(req.url || "/", `http://127.0.0.1:${this.port}`);

		if (req.method === "GET" && url.pathname === "/api/state") {
			this.handleGetState(res);
		} else if (req.method === "GET" && url.pathname === "/api/actions") {
			const timeout = parseInt(url.searchParams.get("timeout") || "30", 10) * 1000;
			this.handleGetActions(res, timeout);
		} else if (req.method === "POST") {
			this.readBody(req, (body) => {
				try {
					const msg = JSON.parse(body) as ClaudeMessage;
					this.handleClaudeMessage(msg);
					res.writeHead(200);
					res.end(JSON.stringify({ ok: true }));
				} catch (err) {
					res.writeHead(400);
					res.end(JSON.stringify({ error: "Invalid JSON" }));
				}
			});
		} else {
			res.writeHead(404);
			res.end(JSON.stringify({ error: "Not found" }));
		}
	}

	private handleGetState(res: http.ServerResponse): void {
		const state = this.walkthrough.getState();
		res.writeHead(200);
		res.end(
			JSON.stringify({
				title: state.title,
				currentSegment: state.segments[state.currentIndex]?.id ?? -1,
				status: state.status,
				totalSegments: state.segments.length,
				currentIndex: state.currentIndex,
			}),
		);
	}

	private handleGetActions(res: http.ServerResponse, timeout: number): void {
		// Return pending action immediately if available
		const action = this.pendingActions.shift();
		if (action) {
			res.writeHead(200);
			res.end(JSON.stringify(action));
			return;
		}

		// Long-poll: wait for next action
		const timer = setTimeout(() => {
			const idx = this.actionWaiters.indexOf(waiter);
			if (idx !== -1) this.actionWaiters.splice(idx, 1);
			res.writeHead(204);
			res.end();
		}, timeout);

		const waiter = (action: UserActionMessage) => {
			clearTimeout(timer);
			res.writeHead(200);
			res.end(JSON.stringify(action));
		};

		this.actionWaiters.push(waiter);

		res.on("close", () => {
			clearTimeout(timer);
			const idx = this.actionWaiters.indexOf(waiter);
			if (idx !== -1) this.actionWaiters.splice(idx, 1);
		});
	}

	// ── WebSocket handler ──

	private handleWs(ws: WebSocket): void {
		this.wsClients.add(ws);

		ws.on("message", (data) => {
			try {
				const msg = JSON.parse(data.toString()) as ClaudeMessage;
				this.handleClaudeMessage(msg);
			} catch {}
		});

		ws.on("close", () => {
			this.wsClients.delete(ws);
		});

		// Send current state on connect
		this.broadcastState();
	}

	// ── Message dispatch ──

	private onClaudeMessage?: (msg: ClaudeMessage) => void;

	setMessageHandler(handler: (msg: ClaudeMessage) => void): void {
		this.onClaudeMessage = handler;
	}

	private handleClaudeMessage(msg: ClaudeMessage): void {
		this.onClaudeMessage?.(msg);
	}

	// ── Helpers ──

	private readBody(req: http.IncomingMessage, cb: (body: string) => void): void {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => cb(body));
	}
}
```

**Step 2: Verify it compiles**

```bash
cd vscode-extension && npx tsc --noEmit src/server.ts
```

**Step 3: Commit**

```bash
git add vscode-extension/src/server.ts
git commit -m "feat: add HTTP + WebSocket server for Claude communication"
```

---

### Task 7: Create sidebar webview provider

**Files:**
- Create: `vscode-extension/src/sidebar.ts`

**Step 1: Write `sidebar.ts`**

```typescript
import * as vscode from "vscode";
import type {
	ToWebviewMessage,
	FromWebviewMessage,
	WalkthroughState,
	Segment,
	WalkthroughStatus,
} from "./types";

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "codeExplainer.sidebar";

	private view?: vscode.WebviewView;
	private onMessage?: (msg: FromWebviewMessage) => void;

	constructor(private readonly extensionUri: vscode.Uri) {}

	setMessageHandler(handler: (msg: FromWebviewMessage) => void): void {
		this.onMessage = handler;
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this.view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
		};

		webviewView.webview.html = this.getHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage((msg: FromWebviewMessage) => {
			this.onMessage?.(msg);
		});
	}

	/** Send a message to the webview */
	postMessage(msg: ToWebviewMessage): void {
		this.view?.webview.postMessage(msg);
	}

	/** Send full state update to webview */
	updateState(state: WalkthroughState): void {
		this.postMessage({
			type: "update",
			title: state.title,
			segments: state.segments,
			currentSegment: state.segments[state.currentIndex]?.id ?? -1,
			status: state.status,
		});
	}

	/** Send audio chunk to webview */
	sendAudioChunk(base64Data: string, sampleRate: number): void {
		this.postMessage({
			type: "audio_chunk",
			data: base64Data,
			sampleRate,
		});
	}

	sendAudioEnd(): void {
		this.postMessage({ type: "audio_end" });
	}

	sendAudioStop(): void {
		this.postMessage({ type: "audio_stop" });
	}

	private getHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, "media", "sidebar.js"),
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, "media", "sidebar.css"),
		);
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${styleUri}">
	<title>Code Explainer</title>
</head>
<body>
	<div id="idle-view">
		<p class="idle-text">Waiting for walkthrough...</p>
		<p class="idle-hint">Run <code>/explainer</code> in Claude to start</p>
	</div>

	<div id="active-view" style="display:none;">
		<div class="header">
			<h2 id="walkthrough-title"></h2>
		</div>

		<div class="now-playing">
			<span id="segment-counter" class="counter"></span>
			<span id="segment-title" class="seg-title"></span>
			<a id="segment-location" class="seg-location" href="#"></a>
		</div>

		<div class="controls">
			<button id="btn-prev" title="Previous segment">&#9198;</button>
			<button id="btn-play-pause" title="Play/Pause">&#9208;</button>
			<button id="btn-next" title="Next segment">&#9197;</button>
		</div>

		<div class="audio-controls">
			<label class="control-row">
				<span class="label">Vol</span>
				<input type="range" id="volume-slider" min="0" max="100" value="80">
				<button id="btn-mute" title="Mute">&#128266;</button>
			</label>
			<label class="control-row">
				<span class="label">Speed</span>
				<div class="speed-buttons" id="speed-buttons">
					<button data-speed="1">1x</button>
					<button data-speed="1.25">1.25x</button>
					<button data-speed="1.5" class="active">1.5x</button>
					<button data-speed="2">2x</button>
				</div>
			</label>
			<label class="control-row">
				<span class="label">Voice</span>
				<select id="voice-select">
					<option value="af_heart">Heart (F)</option>
					<option value="af_bella">Bella (F)</option>
					<option value="af_sarah">Sarah (F)</option>
					<option value="am_adam">Adam (M)</option>
					<option value="am_michael">Michael (M)</option>
					<option value="bf_emma">Emma (BF)</option>
					<option value="bm_george">George (BM)</option>
				</select>
			</label>
		</div>

		<div class="explanation-box">
			<div id="explanation-text" class="explanation-text"></div>
		</div>

		<div class="action-buttons">
			<button id="btn-deeper">Go Deeper</button>
			<button id="btn-zoom-out">Zoom Out</button>
		</div>

		<div class="outline">
			<h3>Outline</h3>
			<ul id="outline-list"></ul>
		</div>
	</div>

	<div id="done-view" style="display:none;">
		<p class="done-text">Walkthrough complete</p>
		<p id="done-summary" class="done-summary"></p>
	</div>

	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function getNonce(): string {
	let text = "";
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
```

**Step 2: Verify it compiles**

```bash
cd vscode-extension && npx tsc --noEmit src/sidebar.ts
```

**Step 3: Commit**

```bash
git add vscode-extension/src/sidebar.ts
git commit -m "feat: add sidebar webview provider with HTML template"
```

---

### Task 8: Create webview styles

**Files:**
- Create: `vscode-extension/media/sidebar.css`

**Step 1: Write `sidebar.css`**

Uses VS Code CSS variables for theme compatibility.

```css
* {
	margin: 0;
	padding: 0;
	box-sizing: border-box;
}

body {
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size);
	color: var(--vscode-foreground);
	padding: 12px;
}

/* ── Idle view ── */

.idle-text {
	text-align: center;
	margin-top: 40px;
	opacity: 0.6;
	font-size: 1.1em;
}

.idle-hint {
	text-align: center;
	margin-top: 8px;
	opacity: 0.4;
	font-size: 0.9em;
}

.idle-hint code {
	background: var(--vscode-textCodeBlock-background);
	padding: 2px 6px;
	border-radius: 3px;
}

/* ── Header ── */

.header h2 {
	font-size: 1.1em;
	font-weight: 600;
	margin-bottom: 12px;
	color: var(--vscode-foreground);
}

/* ── Now playing ── */

.now-playing {
	background: var(--vscode-editor-background);
	border: 1px solid var(--vscode-panel-border);
	border-radius: 6px;
	padding: 10px 12px;
	margin-bottom: 12px;
}

.counter {
	font-size: 0.85em;
	opacity: 0.6;
	margin-right: 6px;
}

.seg-title {
	font-weight: 600;
}

.seg-location {
	display: block;
	margin-top: 4px;
	font-size: 0.85em;
	color: var(--vscode-textLink-foreground);
	text-decoration: none;
	cursor: pointer;
}

.seg-location:hover {
	text-decoration: underline;
}

/* ── Playback controls ── */

.controls {
	display: flex;
	justify-content: center;
	gap: 8px;
	margin-bottom: 12px;
}

.controls button {
	background: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
	border: none;
	border-radius: 6px;
	width: 40px;
	height: 36px;
	font-size: 1.1em;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
}

.controls button:hover {
	background: var(--vscode-button-secondaryHoverBackground);
}

/* ── Audio controls ── */

.audio-controls {
	margin-bottom: 12px;
}

.control-row {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 6px;
}

.control-row .label {
	font-size: 0.8em;
	opacity: 0.6;
	width: 40px;
	flex-shrink: 0;
}

.control-row input[type="range"] {
	flex: 1;
	height: 4px;
	accent-color: var(--vscode-focusBorder);
}

.control-row select {
	flex: 1;
	background: var(--vscode-dropdown-background);
	color: var(--vscode-dropdown-foreground);
	border: 1px solid var(--vscode-dropdown-border);
	border-radius: 4px;
	padding: 3px 6px;
	font-size: 0.85em;
}

#btn-mute {
	background: none;
	border: none;
	cursor: pointer;
	font-size: 1em;
	padding: 2px;
	opacity: 0.7;
}

#btn-mute:hover {
	opacity: 1;
}

/* ── Speed buttons ── */

.speed-buttons {
	display: flex;
	gap: 4px;
	flex: 1;
}

.speed-buttons button {
	flex: 1;
	background: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
	border: none;
	border-radius: 4px;
	padding: 3px 6px;
	font-size: 0.8em;
	cursor: pointer;
}

.speed-buttons button:hover {
	background: var(--vscode-button-secondaryHoverBackground);
}

.speed-buttons button.active {
	background: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
}

/* ── Explanation ── */

.explanation-box {
	background: var(--vscode-editor-background);
	border: 1px solid var(--vscode-panel-border);
	border-radius: 6px;
	padding: 12px;
	margin-bottom: 12px;
	max-height: 200px;
	overflow-y: auto;
}

.explanation-text {
	font-size: 0.9em;
	line-height: 1.5;
}

.explanation-text code {
	background: var(--vscode-textCodeBlock-background);
	padding: 1px 4px;
	border-radius: 3px;
	font-family: var(--vscode-editor-font-family);
	font-size: 0.9em;
}

/* ── Action buttons ── */

.action-buttons {
	display: flex;
	gap: 8px;
	margin-bottom: 16px;
}

.action-buttons button {
	flex: 1;
	background: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
	border: none;
	border-radius: 4px;
	padding: 6px 10px;
	font-size: 0.85em;
	cursor: pointer;
}

.action-buttons button:hover {
	background: var(--vscode-button-secondaryHoverBackground);
}

/* ── Outline ── */

.outline h3 {
	font-size: 0.9em;
	font-weight: 600;
	margin-bottom: 8px;
	opacity: 0.8;
}

.outline ul {
	list-style: none;
}

.outline li {
	padding: 4px 8px;
	border-radius: 4px;
	cursor: pointer;
	font-size: 0.85em;
	display: flex;
	align-items: center;
	gap: 6px;
}

.outline li:hover {
	background: var(--vscode-list-hoverBackground);
}

.outline li.current {
	background: var(--vscode-list-activeSelectionBackground);
	color: var(--vscode-list-activeSelectionForeground);
}

.outline li.completed {
	opacity: 0.6;
}

.outline .marker {
	width: 16px;
	text-align: center;
	flex-shrink: 0;
}

/* ── Done view ── */

.done-text {
	text-align: center;
	margin-top: 40px;
	font-size: 1.1em;
	font-weight: 600;
}

.done-summary {
	text-align: center;
	margin-top: 8px;
	opacity: 0.6;
}
```

**Step 2: Commit**

```bash
git add vscode-extension/media/sidebar.css
git commit -m "feat: add sidebar webview styles with VS Code theme support"
```

---

### Task 9: Create webview JavaScript

**Files:**
- Create: `vscode-extension/media/sidebar.js`

**Step 1: Write `sidebar.js`**

This runs inside the webview sandbox. Handles audio playback via Web Audio API, UI updates, and communication with the extension via `postMessage`.

```javascript
// @ts-check

/** @type {ReturnType<typeof acquireVsCodeApi>} */
const vscode = acquireVsCodeApi();

// ── State ──

let state = {
	title: "",
	segments: [],
	currentSegment: -1,
	status: "idle",
};

// ── Audio player ──

/** @type {AudioContext | null} */
let audioCtx = null;
/** @type {GainNode | null} */
let gainNode = null;
let nextPlayTime = 0;
/** @type {AudioBufferSourceNode[]} */
let activeSources = [];
let playbackSpeed = 1.5;
let volume = 0.8;
let muted = false;
let audioPlaying = false;

function ensureAudioContext() {
	if (!audioCtx) {
		audioCtx = new AudioContext({ sampleRate: 24000 });
		gainNode = audioCtx.createGain();
		gainNode.gain.value = muted ? 0 : volume;
		gainNode.connect(audioCtx.destination);
	}
	if (audioCtx.state === "suspended") {
		audioCtx.resume();
	}
}

function playAudioChunk(base64Data, sampleRate) {
	ensureAudioContext();

	const binary = atob(base64Data);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	const float32 = new Float32Array(bytes.buffer);

	const buffer = audioCtx.createBuffer(1, float32.length, sampleRate);
	buffer.getChannelData(0).set(float32);

	const source = audioCtx.createBufferSource();
	source.buffer = buffer;
	source.playbackRate.value = playbackSpeed;
	source.connect(gainNode);

	const now = audioCtx.currentTime;
	if (nextPlayTime < now) nextPlayTime = now;
	source.start(nextPlayTime);
	nextPlayTime += buffer.duration / playbackSpeed;

	activeSources.push(source);
	source.onended = () => {
		const idx = activeSources.indexOf(source);
		if (idx !== -1) activeSources.splice(idx, 1);
	};

	audioPlaying = true;
}

function stopAudio() {
	for (const source of activeSources) {
		try { source.stop(); } catch {}
	}
	activeSources = [];
	nextPlayTime = 0;
	audioPlaying = false;
}

function onAudioEnd() {
	// Audio stream finished — wait for last chunk to play, then auto-advance
	if (activeSources.length === 0) {
		autoAdvance();
		return;
	}
	// Set onended on the last source to trigger auto-advance
	const lastSource = activeSources[activeSources.length - 1];
	const originalOnEnded = lastSource.onended;
	lastSource.onended = (e) => {
		if (originalOnEnded) originalOnEnded.call(lastSource, e);
		if (state.status === "playing") {
			autoAdvance();
		}
	};
}

function autoAdvance() {
	audioPlaying = false;
	if (state.status === "playing") {
		vscode.postMessage({ type: "next" });
	}
}

function updateVolume() {
	if (gainNode) {
		gainNode.gain.value = muted ? 0 : volume;
	}
}

// ── UI rendering ──

function render() {
	const idleView = document.getElementById("idle-view");
	const activeView = document.getElementById("active-view");
	const doneView = document.getElementById("done-view");

	if (state.status === "idle") {
		idleView.style.display = "";
		activeView.style.display = "none";
		doneView.style.display = "none";
		return;
	}

	if (state.status === "stopped") {
		idleView.style.display = "none";
		activeView.style.display = "none";
		doneView.style.display = "";
		document.getElementById("done-summary").textContent =
			`${state.segments.length} segments covered`;
		return;
	}

	idleView.style.display = "none";
	activeView.style.display = "";
	doneView.style.display = "none";

	// Title
	document.getElementById("walkthrough-title").textContent = state.title;

	// Now playing
	const seg = state.segments.find((s) => s.id === state.currentSegment);
	const idx = state.segments.findIndex((s) => s.id === state.currentSegment);

	if (seg) {
		document.getElementById("segment-counter").textContent =
			`${idx + 1}/${state.segments.length}`;
		document.getElementById("segment-title").textContent = seg.title;

		const loc = document.getElementById("segment-location");
		const fileName = seg.file.split("/").pop();
		loc.textContent = `${fileName}:${seg.start}-${seg.end}`;
		loc.dataset.file = seg.file;
		loc.dataset.start = String(seg.start);
		loc.dataset.end = String(seg.end);
	}

	// Play/pause button
	const playBtn = document.getElementById("btn-play-pause");
	playBtn.textContent = state.status === "playing" ? "\u23F8" : "\u25B6";
	playBtn.title = state.status === "playing" ? "Pause" : "Play";

	// Explanation
	if (seg) {
		document.getElementById("explanation-text").innerHTML = simpleMarkdown(seg.explanation);
	}

	// Outline
	renderOutline(idx);
}

function renderOutline(currentIdx) {
	const list = document.getElementById("outline-list");
	list.innerHTML = "";

	for (let i = 0; i < state.segments.length; i++) {
		const seg = state.segments[i];
		const li = document.createElement("li");

		if (i === currentIdx) li.className = "current";
		else if (i < currentIdx) li.className = "completed";

		const marker = document.createElement("span");
		marker.className = "marker";
		if (i < currentIdx) marker.textContent = "\u2713";
		else if (i === currentIdx) marker.textContent = "\u25B6";
		else marker.textContent = "\u25CB";

		const text = document.createElement("span");
		text.textContent = `${i + 1}. ${seg.title}`;

		li.appendChild(marker);
		li.appendChild(text);
		li.addEventListener("click", () => {
			vscode.postMessage({ type: "goto_segment", segmentId: seg.id });
		});
		list.appendChild(li);
	}
}

function simpleMarkdown(text) {
	if (!text) return "";
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/`(.+?)`/g, "<code>$1</code>")
		.replace(/\n\n/g, "<br><br>")
		.replace(/\n/g, "<br>");
}

// ── Event handlers ──

document.getElementById("btn-play-pause").addEventListener("click", () => {
	vscode.postMessage({ type: "play_pause" });
});

document.getElementById("btn-next").addEventListener("click", () => {
	vscode.postMessage({ type: "next" });
});

document.getElementById("btn-prev").addEventListener("click", () => {
	vscode.postMessage({ type: "prev" });
});

document.getElementById("btn-deeper").addEventListener("click", () => {
	vscode.postMessage({ type: "go_deeper" });
});

document.getElementById("btn-zoom-out").addEventListener("click", () => {
	vscode.postMessage({ type: "zoom_out" });
});

document.getElementById("volume-slider").addEventListener("input", (e) => {
	volume = parseInt(e.target.value, 10) / 100;
	updateVolume();
	vscode.postMessage({ type: "volume_change", volume });
});

document.getElementById("btn-mute").addEventListener("click", () => {
	muted = !muted;
	document.getElementById("btn-mute").textContent = muted ? "\uD83D\uDD07" : "\uD83D\uDD0A";
	updateVolume();
	vscode.postMessage({ type: "mute_toggle" });
});

document.getElementById("voice-select").addEventListener("change", (e) => {
	vscode.postMessage({ type: "voice_change", voice: e.target.value });
});

// Speed buttons
document.querySelectorAll("#speed-buttons button").forEach((btn) => {
	btn.addEventListener("click", () => {
		playbackSpeed = parseFloat(btn.dataset.speed);
		document.querySelectorAll("#speed-buttons button").forEach((b) =>
			b.classList.remove("active"),
		);
		btn.classList.add("active");
		vscode.postMessage({ type: "speed_change", speed: playbackSpeed });
	});
});

// ── Message handler from extension ──

window.addEventListener("message", (event) => {
	const msg = event.data;

	switch (msg.type) {
		case "update":
			state = {
				title: msg.title,
				segments: msg.segments,
				currentSegment: msg.currentSegment,
				status: msg.status,
			};
			render();
			break;

		case "audio_chunk":
			playAudioChunk(msg.data, msg.sampleRate);
			break;

		case "audio_end":
			onAudioEnd();
			break;

		case "audio_stop":
			stopAudio();
			break;
	}
});

// Initial render
render();
```

**Step 2: Commit**

```bash
git add vscode-extension/media/sidebar.js
git commit -m "feat: add webview JS with Web Audio streaming and UI controls"
```

---

### Task 10: Create activity bar icon

**Files:**
- Create: `vscode-extension/media/icon.svg`

**Step 1: Write a monochrome 24x24 SVG icon**

VS Code activity bar icons must be monochrome (single color, VS Code applies its own tinting).

```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 5h16v2H4V5zm0 4h10v2H4V9zm0 4h16v2H4v-2zm0 4h10v2H4v-2z" fill="#C5C5C5"/>
  <path d="M17 10l4 2.5L17 15v-5z" fill="#C5C5C5"/>
</svg>
```

This shows code lines with a play arrow — representing code walkthroughs.

**Step 2: Commit**

```bash
git add vscode-extension/media/icon.svg
git commit -m "feat: add monochrome activity bar icon"
```

---

### Task 11: Rewrite extension entry point

**Files:**
- Modify: `vscode-extension/src/extension.ts` (entire file rewrite)

**Step 1: Rewrite `extension.ts`**

This wires all components together.

```typescript
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Walkthrough } from "./walkthrough";
import { ExplainerServer } from "./server";
import { SidebarProvider } from "./sidebar";
import { highlightRange, clearHighlights, disposeHighlights } from "./highlight";
import { streamTTS, isTTSAvailable } from "./tts-bridge";
import type { ClaudeMessage, FromWebviewMessage, Segment } from "./types";

// ── File-watcher fallback (backward compat) ──

const HIGHLIGHT_FILE = path.join(os.homedir(), ".claude-highlight.json");

interface HighlightRequest {
	file: string;
	start: number;
	end: number;
}

let fileWatcher: fs.StatWatcher | undefined;

function startFileWatcher(): void {
	try {
		processHighlightFile();
	} catch {}

	fileWatcher = fs.watchFile(
		HIGHLIGHT_FILE,
		{ interval: 300 },
		(curr, prev) => {
			if (curr.mtimeMs !== prev.mtimeMs) {
				processHighlightFile();
			}
		},
	);
}

function processHighlightFile(): void {
	let raw: string;
	try {
		raw = fs.readFileSync(HIGHLIGHT_FILE, "utf-8");
	} catch {
		return;
	}

	let request: HighlightRequest;
	try {
		request = JSON.parse(raw);
	} catch {
		return;
	}

	if (!request.file || typeof request.start !== "number" || typeof request.end !== "number") {
		return;
	}

	highlightRange(request.file, request.start, request.end).catch((err) => {
		console.error("[code-explainer] Fallback highlight failed:", err);
	});
}

// ── Main activation ──

let abortTTS: (() => void) | undefined;

// TTS settings — updated by webview messages
let ttsVoice = "af_heart";
let ttsSpeed = 1.0;

export function activate(context: vscode.ExtensionContext): void {
	const walkthrough = new Walkthrough();
	const sidebar = new SidebarProvider(context.extensionUri);
	const server = new ExplainerServer(walkthrough);

	// Register sidebar
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	);

	// Start file-watcher fallback
	startFileWatcher();

	// Start HTTP+WS server
	server.start().then((port) => {
		console.log(`[code-explainer] Server listening on port ${port}`);
	});

	// ── Walkthrough events → sidebar + highlights ──

	walkthrough.on("segment", (segment: Segment) => {
		// Highlight code in editor
		highlightRange(segment.file, segment.start, segment.end).catch(() => {});

		// Update sidebar
		sidebar.updateState(walkthrough.getState());

		// Stop current TTS and start new
		if (abortTTS) abortTTS();
		sidebar.sendAudioStop();

		if (segment.ttsText && isTTSAvailable()) {
			abortTTS = streamTTS(
				segment.ttsText,
				{ voice: ttsVoice, speed: ttsSpeed },
				(base64, sampleRate) => sidebar.sendAudioChunk(base64, sampleRate),
				() => sidebar.sendAudioEnd(),
				(err) => console.error("[code-explainer] TTS error:", err),
			);
		} else {
			// No TTS — send audio_end immediately so auto-advance works after a delay
			setTimeout(() => sidebar.sendAudioEnd(), 3000);
		}
	});

	walkthrough.on("plan", () => {
		sidebar.updateState(walkthrough.getState());
		server.broadcastState();
	});

	walkthrough.on("status", () => {
		sidebar.updateState(walkthrough.getState());
		server.broadcastState();

		// If paused, suspend audio
		const state = walkthrough.getState();
		if (state.status === "paused" || state.status === "stopped") {
			if (abortTTS) {
				abortTTS();
				abortTTS = undefined;
			}
			sidebar.sendAudioStop();
		}

		if (state.status === "stopped") {
			clearHighlights();
		}
	});

	// ── Claude messages → walkthrough state ──

	server.setMessageHandler((msg: ClaudeMessage) => {
		switch (msg.type) {
			case "set_plan":
				walkthrough.setPlan(msg.title, msg.segments);
				break;
			case "insert_after":
				walkthrough.insertAfter(msg.afterSegment, msg.segments);
				break;
			case "replace_segment":
				walkthrough.replaceSegment(msg.id, msg.segment);
				break;
			case "remove_segments":
				walkthrough.removeSegments(msg.ids);
				break;
			case "goto":
				walkthrough.goto(msg.segmentId);
				break;
			case "resume":
				walkthrough.play();
				// Re-trigger current segment to restart TTS
				const seg = walkthrough.getCurrentSegment();
				if (seg) walkthrough.emit("segment", seg);
				break;
			case "stop":
				walkthrough.stop();
				break;
		}
	});

	// ── Webview messages → walkthrough state + server ──

	sidebar.setMessageHandler((msg: FromWebviewMessage) => {
		switch (msg.type) {
			case "play_pause":
				walkthrough.togglePlayPause();
				// If resuming, re-trigger segment for TTS
				if (walkthrough.getState().status === "playing") {
					const seg = walkthrough.getCurrentSegment();
					if (seg) walkthrough.emit("segment", seg);
				}
				break;
			case "next":
				if (abortTTS) abortTTS();
				sidebar.sendAudioStop();
				walkthrough.next();
				break;
			case "prev":
				if (abortTTS) abortTTS();
				sidebar.sendAudioStop();
				walkthrough.prev();
				break;
			case "goto_segment":
				if (abortTTS) abortTTS();
				sidebar.sendAudioStop();
				walkthrough.goto(msg.segmentId);
				break;
			case "go_deeper": {
				const segment = walkthrough.getCurrentSegment();
				if (segment) {
					walkthrough.pause();
					server.queueAction({
						type: "user_action",
						action: "go_deeper",
						segmentId: segment.id,
					});
				}
				break;
			}
			case "zoom_out": {
				const segment = walkthrough.getCurrentSegment();
				if (segment) {
					walkthrough.pause();
					server.queueAction({
						type: "user_action",
						action: "zoom_out",
						segmentId: segment.id,
					});
				}
				break;
			}
			case "speed_change":
				ttsSpeed = msg.speed;
				break;
			case "volume_change":
				// Volume is handled in webview's Web Audio GainNode
				break;
			case "voice_change":
				ttsVoice = msg.voice;
				break;
			case "mute_toggle":
				// Mute is handled in webview's Web Audio GainNode
				break;
		}
	});

	// ── Cleanup ──

	context.subscriptions.push({
		dispose: () => {
			server.stop();
			if (fileWatcher) {
				fs.unwatchFile(HIGHLIGHT_FILE);
				fileWatcher = undefined;
			}
			if (abortTTS) abortTTS();
			disposeHighlights();
		},
	});
}

export function deactivate(): void {}
```

**Step 2: Verify full project compiles**

```bash
cd vscode-extension && npx tsc --noEmit
```

Expected: No errors.

**Step 3: Verify esbuild bundles**

```bash
cd vscode-extension && npm run compile
```

Expected: `out/extension.js` created with bundled code.

**Step 4: Commit**

```bash
git add vscode-extension/src/extension.ts
git commit -m "feat: rewrite extension.ts to wire sidebar, server, TTS, and highlights"
```

---

### Task 12: Create Claude helper script

**Files:**
- Create: `scripts/explainer.sh`

**Step 1: Write `explainer.sh`**

A thin curl wrapper so Claude can interact with the extension's HTTP API easily.

```bash
#!/bin/bash
# Helper for Claude to communicate with the Code Explainer VS Code extension.
# Usage:
#   explainer.sh plan <json_file>      Send walkthrough plan from file
#   explainer.sh send <json_string>    Send raw JSON message
#   explainer.sh state                 Get current walkthrough state
#   explainer.sh wait-action [timeout] Wait for user action (default 30s)
#   explainer.sh stop                  Stop the walkthrough

PORT_FILE="$HOME/.claude-explainer-port"

if [ ! -f "$PORT_FILE" ]; then
    echo '{"error": "Code Explainer extension not running (no port file)"}' >&2
    exit 1
fi

PORT=$(cat "$PORT_FILE")
BASE="http://127.0.0.1:$PORT"

case "$1" in
    plan)
        if [ -z "$2" ]; then
            echo "Usage: explainer.sh plan <json_file>" >&2
            exit 1
        fi
        curl -s -X POST "$BASE/api/plan" \
            -H 'Content-Type: application/json' \
            -d @"$2"
        ;;
    send)
        if [ -z "$2" ]; then
            echo "Usage: explainer.sh send '<json>'" >&2
            exit 1
        fi
        curl -s -X POST "$BASE/api/plan" \
            -H 'Content-Type: application/json' \
            -d "$2"
        ;;
    state)
        curl -s "$BASE/api/state"
        ;;
    wait-action)
        TIMEOUT="${2:-30}"
        curl -s --max-time "$((TIMEOUT + 5))" "$BASE/api/actions?timeout=$TIMEOUT"
        ;;
    stop)
        curl -s -X POST "$BASE/api/plan" \
            -H 'Content-Type: application/json' \
            -d '{"type": "stop"}'
        ;;
    *)
        echo "Usage: explainer.sh {plan|send|state|wait-action|stop}" >&2
        exit 1
        ;;
esac
```

**Step 2: Make executable**

```bash
chmod +x scripts/explainer.sh
```

**Step 3: Verify it runs (should show error since extension isn't running)**

```bash
scripts/explainer.sh state 2>&1
```

Expected: Error message about extension not running.

**Step 4: Commit**

```bash
git add scripts/explainer.sh
git commit -m "feat: add Claude helper script for extension HTTP API"
```

---

### Task 13: Update setup.sh for new extension build

**Files:**
- Modify: `setup.sh`

**Step 1: Find and update the extension build section in `setup.sh`**

The setup script needs to:
1. Run `npm install` in the vscode-extension directory (installs ws, esbuild, etc.)
2. Run `npm run compile` instead of `tsc`
3. Package with the updated script

Look for the section that does `cd vscode-extension && npm install && tsc` and replace `tsc -p ./` with `npm run compile`. The `package` script already handles the rest.

**Step 2: Verify setup.sh still works**

```bash
bash setup.sh --help 2>&1 | head -5
```

**Step 3: Commit**

```bash
git add setup.sh
git commit -m "build: update setup.sh for esbuild-based extension build"
```

---

### Task 14: Build, package, and end-to-end verification

**Step 1: Full build**

```bash
cd vscode-extension && npm install && npm run compile
```

Expected: `out/extension.js` generated, no errors.

**Step 2: Package VSIX**

```bash
cd vscode-extension && npm run package
```

Expected: `code-explainer-0.2.0.vsix` created.

**Step 3: Install in VS Code**

```bash
code --install-extension vscode-extension/code-explainer-0.2.0.vsix
```

Expected: Extension installs. Reload VS Code.

**Step 4: Verify sidebar appears**

Open VS Code. Look for the Code Explainer icon in the Activity Bar (left side). Click it. Should show "Waiting for walkthrough..." idle state.

**Step 5: Verify port file created**

```bash
cat ~/.claude-explainer-port
```

Expected: A port number (e.g., `54321`).

**Step 6: Test sending a plan via curl**

```bash
PORT=$(cat ~/.claude-explainer-port)
curl -s -X POST "http://127.0.0.1:$PORT/api/plan" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "set_plan",
    "title": "Test Walkthrough",
    "segments": [
      {
        "id": 1,
        "file": "'$(pwd)'/scripts/speak.sh",
        "start": 1,
        "end": 8,
        "title": "Script header",
        "explanation": "This is the **speak script** header. It sets up text-to-speech using the persistent TTS server.",
        "ttsText": "This is the speak script header. It sets up text to speech using the persistent server."
      },
      {
        "id": 2,
        "file": "'$(pwd)'/scripts/speak.sh",
        "start": 16,
        "end": 19,
        "title": "Kill previous speech",
        "explanation": "Before speaking new text, the script **kills any previous speech** to avoid overlapping audio.",
        "ttsText": "Before speaking new text, the script kills any previous speech to avoid overlapping audio."
      }
    ]
  }'
```

Expected:
- Sidebar switches from idle to active view
- Shows "Test Walkthrough" title
- First segment highlighted in editor
- speak.sh opens with lines 1-8 highlighted in gold
- Explanation text appears in sidebar
- TTS plays if tts_server is running
- After audio finishes, auto-advances to segment 2

**Step 7: Test state endpoint**

```bash
PORT=$(cat ~/.claude-explainer-port)
curl -s "http://127.0.0.1:$PORT/api/state" | python3 -m json.tool
```

Expected: JSON showing current segment, status, etc.

**Step 8: Test helper script**

```bash
scripts/explainer.sh state
```

Expected: Same state JSON.

**Step 9: Test stop**

```bash
scripts/explainer.sh stop
```

Expected: Sidebar shows "Walkthrough complete".

**Step 10: Verify fallback still works**

```bash
echo '{"file":"'$(pwd)'/scripts/speak.sh","start":1,"end":5}' > ~/.claude-highlight.json
```

Expected: speak.sh opens with lines 1-5 highlighted (file-watcher fallback).

**Step 11: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end testing"
```

---

### Task 15: Update skill docs for new protocol

**Files:**
- Modify: `docs/step5-autoplay.md`
- Modify: `docs/step5-interactive.md`
- Modify: `SKILL.md`

**Step 1: Update autoplay and interactive docs**

Add documentation explaining that when the VS Code extension sidebar is available (port file exists), Claude should use the HTTP API instead of the file-based highlight protocol:

1. Check if `~/.claude-explainer-port` exists
2. If yes, use `scripts/explainer.sh plan <file>` to send the walkthrough plan
3. Use `scripts/explainer.sh wait-action` to wait for user actions (go deeper, zoom out)
4. Use `scripts/explainer.sh send` for mutations (insert_after, replace_segment)
5. If no, fall back to existing file-watcher protocol

**Step 2: Update SKILL.md checklist**

Add a check for the sidebar extension in the setup/prerequisites section.

**Step 3: Commit**

```bash
git add docs/ SKILL.md
git commit -m "docs: update skill docs for sidebar extension protocol"
```
