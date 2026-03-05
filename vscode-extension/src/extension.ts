import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Walkthrough } from "./walkthrough";
import { ExplainerServer } from "./server";
import { SidebarProvider } from "./sidebar";
import { highlightRange, highlightSegmentRange, highlightSubRange, clearHighlights, disposeHighlights, enableSmoothScrolling, restoreSmoothScrolling } from "./highlight";
import { streamTTS, isTTSAvailable, ensureServer } from "./tts-bridge";
import type { AgentMessage, FromWebviewMessage, Segment, Highlight } from "./types";

// ── File-watcher fallback (backward compat) ──

const HIGHLIGHT_FILE = path.join(os.homedir(), ".claude-highlight.json");

interface HighlightRequest {
	file: string;
	start: number;
	end: number;
}

let fileWatcher: fs.StatWatcher | undefined;

function startFileWatcher(): void {
	// Delete any stale highlight file from a previous session
	// instead of processing it — only react to NEW highlight requests
	try {
		fs.unlinkSync(HIGHLIGHT_FILE);
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
			// Wait for the webview to signal actual playback completion,
			// not just the TTS server finishing its stream.
			sidebar.waitForPlaybackComplete().then(resolve);

			abortFn = streamTTS(
				highlight.ttsText,
				{ voice, speed },
				(base64, sampleRate) => {
					if (!aborted) sidebar.sendAudioChunk(base64, sampleRate);
				},
				() => {
					if (!aborted) sidebar.sendAudioEnd();
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

	let abortTTS: (() => void) | undefined;
	// TTS settings — updated by webview messages
	let ttsVoice = "af_heart";
	let ttsSpeed = 1;

	let currentChunkAbort: (() => void) | undefined;
	let highlightLoopGeneration = 0;

	async function playSegmentHighlights(
		segment: Segment,
		wt: Walkthrough,
		sb: SidebarProvider,
	): Promise<void> {
		const myGeneration = ++highlightLoopGeneration;

		const highlights = segment.highlights;

		// If not playing, just show the code location without starting TTS
		if (wt.getState().status !== "playing") {
			if (highlights && highlights.length > 0) {
				await highlightSegmentRange(segment.file, segment.start, segment.end).catch(() => {});
			} else {
				highlightRange(segment.file, segment.start, segment.end).catch(() => {});
			}
			sb.updateState(wt.getState());
			return;
		}

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
			wt.next();
		}
	}

	walkthrough.on("segment", (segment: Segment) => {
		// Enable smooth scrolling for the walkthrough
		enableSmoothScrolling().catch(() => {});

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
			// Only force-stop audio on pause (user wants silence now).
			// On "stopped" (natural end), let webview audio drain naturally.
			if (state.status === "paused") {
				sidebar.sendAudioStop();
			}
		}

		if (state.status === "stopped") {
			clearHighlights();
			restoreSmoothScrolling().catch(() => {});
		}
	});

	// ── Agent messages → walkthrough state ──

	server.setMessageHandler((msg: AgentMessage) => {
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
				walkthrough.navigateTo(msg.segmentId);
				break;
			case "resume":
				walkthrough.play();
				// Pre-warm TTS server then re-trigger segment
				const seg = walkthrough.getCurrentSegment();
				if (seg) {
					const gen = ++highlightLoopGeneration;
					ensureServer().then(() => {
						if (gen === highlightLoopGeneration && walkthrough.getState().status === "playing") {
							walkthrough.emit("segment", seg);
						}
					});
				}
				break;
			case "stop":
				sidebar.sendAudioStop();
				walkthrough.stop();
				break;
		}
	});

	// ── Webview messages → walkthrough state + server ──

	sidebar.setMessageHandler((msg: FromWebviewMessage) => {
		switch (msg.type) {
			case "play_pause":
				walkthrough.togglePlayPause();
				// If resuming, pre-warm TTS server then re-trigger segment
				if (walkthrough.getState().status === "playing") {
					const seg = walkthrough.getCurrentSegment();
					if (seg) {
						const gen = ++highlightLoopGeneration;
						ensureServer().then(() => {
							// Guard: user may have paused during server startup
							if (gen === highlightLoopGeneration && walkthrough.getState().status === "playing") {
								walkthrough.emit("segment", seg);
							}
						});
					}
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
				if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
				if (abortTTS) abortTTS();
				sidebar.sendAudioStop();
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
			restoreSmoothScrolling().catch(() => {});
			disposeHighlights();
		},
	});
}

export function deactivate(): void {}
