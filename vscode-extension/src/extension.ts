import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Walkthrough } from "./walkthrough";
import { ExplainerServer } from "./server";
import { SidebarProvider } from "./sidebar";
import { highlightRange, highlightSegmentRange, highlightSubRange, clearHighlights, disposeHighlights } from "./highlight";
import { streamTTS, isTTSAvailable } from "./tts-bridge";
import type { ClaudeMessage, FromWebviewMessage, Segment, Highlight } from "./types";

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

function playHighlightChunk(
	segment: Segment,
	highlight: Highlight,
	sidebar: SidebarProvider,
	voice: string,
	speed: number,
): { promise: Promise<void>; abort: () => void } {
	let abortFn: (() => void) | undefined;
	let aborted = false;

	const promise = new Promise<void>((resolve) => {
		highlightSubRange(segment.file, highlight.start, highlight.end).catch(() => {});

		if (highlight.ttsText && isTTSAvailable()) {
			abortFn = streamTTS(
				highlight.ttsText,
				{ voice, speed },
				(base64, sampleRate) => {
					if (!aborted) sidebar.sendAudioChunk(base64, sampleRate);
				},
				() => {
					if (!aborted) sidebar.sendAudioEnd();
					resolve();
				},
				(err) => {
					console.error("[code-explainer] TTS error:", err);
					resolve();
				},
			);
		} else {
			const timer = setTimeout(() => resolve(), 2000);
			abortFn = () => clearTimeout(timer);
		}
	});

	return {
		promise,
		abort: () => {
			aborted = true;
			if (abortFn) abortFn();
		},
	};
}

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

	let currentChunkAbort: (() => void) | undefined;
	let highlightLoopGeneration = 0;

	async function playSegmentHighlights(
		segment: Segment,
		wt: Walkthrough,
		sb: SidebarProvider,
	): Promise<void> {
		const myGeneration = ++highlightLoopGeneration;

		const highlights = segment.highlights;
		if (!highlights || highlights.length === 0) {
			// Fallback: single highlight, single TTS (legacy behavior)
			highlightRange(segment.file, segment.start, segment.end).catch(() => {});
			sb.updateState(wt.getState());

			if (segment.ttsText && isTTSAvailable()) {
				abortTTS = streamTTS(
					segment.ttsText,
					{ voice: ttsVoice, speed: ttsSpeed },
					(base64, sampleRate) => sb.sendAudioChunk(base64, sampleRate),
					() => sb.sendAudioEnd(),
					(err) => console.error("[code-explainer] TTS error:", err),
				);
			} else {
				setTimeout(() => sb.sendAudioEnd(), 3000);
			}
			return;
		}

		// Multi-highlight path
		await highlightSegmentRange(segment.file, segment.start, segment.end).catch(() => {});
		sb.updateState(wt.getState());

		for (let i = 0; i < highlights.length; i++) {
			if (myGeneration !== highlightLoopGeneration) return;

			sb.sendHighlightAdvance(i, highlights.length);

			const chunk = playHighlightChunk(
				segment,
				highlights[i],
				sb,
				ttsVoice,
				ttsSpeed,
			);
			currentChunkAbort = chunk.abort;

			await chunk.promise;
			currentChunkAbort = undefined;

			if (myGeneration !== highlightLoopGeneration) return;
		}

		// All highlights done — auto-advance to next segment
		if (myGeneration === highlightLoopGeneration && wt.getState().status === "playing") {
			sb.sendAudioStop();
			wt.next();
		}
	}

	walkthrough.on("segment", (segment: Segment) => {
		// Increment generation to invalidate any in-flight highlight loop
		highlightLoopGeneration++;
		if (currentChunkAbort) {
			currentChunkAbort();
			currentChunkAbort = undefined;
		}
		if (abortTTS) {
			abortTTS();
			abortTTS = undefined;
		}
		sidebar.sendAudioStop();

		playSegmentHighlights(segment, walkthrough, sidebar).catch((err) => {
			console.error("[code-explainer] Highlight loop error:", err);
		});
	});

	walkthrough.on("plan", () => {
		sidebar.updateState(walkthrough.getState());
		server.broadcastState();
	});

	walkthrough.on("status", () => {
		sidebar.updateState(walkthrough.getState());
		server.broadcastState();

		const state = walkthrough.getState();
		if (state.status === "paused" || state.status === "stopped") {
			if (currentChunkAbort) {
				currentChunkAbort();
				currentChunkAbort = undefined;
			}
			if (abortTTS) {
				abortTTS();
				abortTTS = undefined;
			}
			highlightLoopGeneration++;
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
				sidebar.reveal();
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
				if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
				if (abortTTS) abortTTS();
				sidebar.sendAudioStop();
				walkthrough.next();
				break;
			case "prev":
				if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
				if (abortTTS) abortTTS();
				sidebar.sendAudioStop();
				walkthrough.prev();
				break;
			case "goto_segment":
				if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
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
			case "restart": {
				const segments = walkthrough.getState().segments;
				if (segments.length > 0) {
					walkthrough.goto(segments[0].id);
				}
				break;
			}
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
