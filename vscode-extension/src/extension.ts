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
let ttsSpeed = 1.5;

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
