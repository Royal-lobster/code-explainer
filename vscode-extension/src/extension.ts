import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Walkthrough } from "./walkthrough";
import { ExplainerServer } from "./server";
import { SidebarProvider } from "./sidebar";
import { highlightRange, highlightSegmentRange, highlightSubRange, clearHighlights, disposeHighlights, enableSmoothScrolling, restoreSmoothScrolling } from "./highlight";
import { streamTTS, isTTSAvailable, ensureServer, setWorkspaceRoot } from "./tts-bridge";
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
	highlightIndex: number,
	sidebar: SidebarProvider,
	voice: string,
	speed: number,
): { promise: Promise<void>; abort: () => void } {
	let abortFn: (() => void) | undefined;
	let aborted = false;

	const promise = new Promise<void>((resolve) => {
		highlightSubRange(segment.file, highlight.start, highlight.end, segment.highlights).catch(() => {});

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
	// Set workspace root so TTS bridge can find venv Python
	const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (wsFolder) setWorkspaceRoot(wsFolder);

	const walkthrough = new Walkthrough();
	const sidebar = new SidebarProvider(context.extensionUri);
	const server = new ExplainerServer(walkthrough);

	// Register sidebar
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	);

	// Initialize walkthrough-active context as false
	vscode.commands.executeCommand('setContext', 'codeExplainer.walkthroughActive', false);

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
	// When navigating prev_highlight across segment boundary, we want to start
	// from the last highlight of the previous segment instead of the default 0.
	let pendingHighlightStart: number | undefined;

	/** Pre-warm the TTS server then resume playback from a specific highlight index. */
	function preWarmAndResume(startHighlight: number): void {
		const seg = walkthrough.getCurrentSegment();
		if (!seg) return;
		highlightLoopGeneration++;
		if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
		sidebar.sendAudioStop();
		sidebar.sendServerLoading(true);
		const segId = seg.id;
		ensureServer().then(() => {
			sidebar.sendServerLoading(false);
			// Guard: segment may have changed while server was warming up
			if (walkthrough.getCurrentSegment()?.id !== segId) return;
			if (walkthrough.getState().status === "playing") {
				playSegmentHighlights(seg, walkthrough, sidebar, startHighlight).catch((err) => {
					console.error("[code-explainer] Highlight loop error:", err);
				});
			}
		}).catch((err) => {
			sidebar.sendServerLoading(false);
			console.error("[code-explainer] ensureServer failed:", err);
		});
	}

	async function playSegmentHighlights(
		segment: Segment,
		wt: Walkthrough,
		sb: SidebarProvider,
		startFromHighlight = 0,
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

		for (let i = startFromHighlight; i < highlights.length; i++) {
			if (myGeneration !== highlightLoopGeneration) return;

			wt.setHighlightIndex(i);
			sb.sendHighlightAdvance(i, highlights.length, highlights[i].explanation);

			const chunk = playHighlightChunk(
				segment,
				highlights[i],
				i,
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

		const startIdx = pendingHighlightStart ?? 0;
		pendingHighlightStart = undefined;
		playSegmentHighlights(segment, walkthrough, sidebar, startIdx).catch((err) => {
			console.error("[code-explainer] Highlight loop error:", err);
		});
	});

	walkthrough.on("plan", () => {
		sidebar.updateState(walkthrough.getState());
		server.broadcastState();
		vscode.commands.executeCommand('setContext', 'codeExplainer.walkthroughActive', true);
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
			vscode.commands.executeCommand('setContext', 'codeExplainer.walkthroughActive', false);
		}
	});

	// ── Keybinding command registrations ──

	const speedPresets = [0.75, 1, 1.25, 1.5, 2];

	context.subscriptions.push(
		vscode.commands.registerCommand('codeExplainer.togglePlayPause', () => {
			walkthrough.togglePlayPause();
			if (walkthrough.getState().status === "playing") {
				preWarmAndResume(walkthrough.getHighlightIndex());
			}
		}),
		vscode.commands.registerCommand('codeExplainer.next', () => {
			const seg = walkthrough.getCurrentSegment();
			if (seg?.highlights && seg.highlights.length > 0) {
				const curIdx = walkthrough.getHighlightIndex();
				if (curIdx >= seg.highlights.length - 1) return;
				const nextIdx = curIdx + 1;
				highlightLoopGeneration++;
				if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
				if (abortTTS) { abortTTS(); abortTTS = undefined; }
				sidebar.sendAudioStop();
				walkthrough.setHighlightIndex(nextIdx);
				if (walkthrough.getState().status === "playing") {
					playSegmentHighlights(seg, walkthrough, sidebar, nextIdx).catch((err) => {
						console.error("[code-explainer] Highlight loop error:", err);
					});
				} else {
					sidebar.sendHighlightAdvance(nextIdx, seg.highlights.length);
					highlightSubRange(seg.file, seg.highlights[nextIdx].start, seg.highlights[nextIdx].end).catch(() => {});
				}
			}
		}),
		vscode.commands.registerCommand('codeExplainer.prev', () => {
			const seg = walkthrough.getCurrentSegment();
			if (seg?.highlights && seg.highlights.length > 0) {
				const curIdx = walkthrough.getHighlightIndex();
				if (curIdx <= 0) return;
				const prevIdx = curIdx - 1;
				highlightLoopGeneration++;
				if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
				if (abortTTS) { abortTTS(); abortTTS = undefined; }
				sidebar.sendAudioStop();
				walkthrough.setHighlightIndex(prevIdx);
				if (walkthrough.getState().status === "playing") {
					playSegmentHighlights(seg, walkthrough, sidebar, prevIdx).catch((err) => {
						console.error("[code-explainer] Highlight loop error:", err);
					});
				} else {
					sidebar.sendHighlightAdvance(prevIdx, seg.highlights.length);
					highlightSubRange(seg.file, seg.highlights[prevIdx].start, seg.highlights[prevIdx].end).catch(() => {});
				}
			}
		}),
		vscode.commands.registerCommand('codeExplainer.nextSegment', () => {
			if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
			if (abortTTS) { abortTTS(); abortTTS = undefined; }
			sidebar.sendAudioStop();
			walkthrough.next();
		}),
		vscode.commands.registerCommand('codeExplainer.prevSegment', () => {
			if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
			if (abortTTS) { abortTTS(); abortTTS = undefined; }
			sidebar.sendAudioStop();
			walkthrough.prev();
		}),
		vscode.commands.registerCommand('codeExplainer.stop', () => {
			sidebar.sendAudioStop();
			walkthrough.stop();
		}),
		vscode.commands.registerCommand('codeExplainer.speedUp', () => {
			const currentIdx = speedPresets.indexOf(ttsSpeed);
			const idx = currentIdx === -1 ? 1 : currentIdx;
			const nextIdx = Math.min(idx + 1, speedPresets.length - 1);
			ttsSpeed = speedPresets[nextIdx];
			vscode.window.setStatusBarMessage(`Speed: ${ttsSpeed}x`, 2000);
		}),
		vscode.commands.registerCommand('codeExplainer.speedDown', () => {
			const currentIdx = speedPresets.indexOf(ttsSpeed);
			const idx = currentIdx === -1 ? 1 : currentIdx;
			const nextIdx = Math.max(idx - 1, 0);
			ttsSpeed = speedPresets[nextIdx];
			vscode.window.setStatusBarMessage(`Speed: ${ttsSpeed}x`, 2000);
		}),
	);

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
			case "resume": {
				const resumeHighlightIdx = walkthrough.getHighlightIndex();
				walkthrough.play();
				preWarmAndResume(resumeHighlightIdx);
				break;
			}
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
				// If resuming, pre-warm TTS server then resume from current highlight
				if (walkthrough.getState().status === "playing") {
					preWarmAndResume(walkthrough.getHighlightIndex());
				}
				break;
			case "next_highlight": {
				const seg = walkthrough.getCurrentSegment();
				if (seg?.highlights && seg.highlights.length > 0) {
					const curIdx = walkthrough.getHighlightIndex();
					if (curIdx >= seg.highlights.length - 1) {
						// At last sub-segment — advance to next segment's first highlight
						const nextSegIdx = walkthrough.getState().currentIndex + 1;
						if (nextSegIdx >= walkthrough.getState().segments.length) break; // At walkthrough end
						if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
						if (abortTTS) { abortTTS(); abortTTS = undefined; }
						sidebar.sendAudioStop();
						walkthrough.next(); // emits "segment" → starts from highlight 0
						break;
					}
					const nextIdx = curIdx + 1;
					highlightLoopGeneration++;
					if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
					if (abortTTS) { abortTTS(); abortTTS = undefined; }
					sidebar.sendAudioStop();
					walkthrough.setHighlightIndex(nextIdx);
					if (walkthrough.getState().status === "playing") {
						playSegmentHighlights(seg, walkthrough, sidebar, nextIdx).catch((err) => {
							console.error("[code-explainer] Highlight loop error:", err);
						});
					} else {
						sidebar.sendHighlightAdvance(nextIdx, seg.highlights.length, seg.highlights[nextIdx].explanation);
						highlightSubRange(seg.file, seg.highlights[nextIdx].start, seg.highlights[nextIdx].end, seg.highlights).catch(() => {});
					}
				}
				break;
			}
			case "prev_highlight": {
				const seg = walkthrough.getCurrentSegment();
				if (seg?.highlights && seg.highlights.length > 0) {
					const curIdx = walkthrough.getHighlightIndex();
					if (curIdx <= 0) {
						// At first sub-segment — go to previous segment's last highlight
						const wtState = walkthrough.getState();
						const prevSegIdx = wtState.currentIndex - 1;
						if (prevSegIdx < 0) break; // Already at the very first segment
						const prevSeg = wtState.segments[prevSegIdx];
						const prevHighlightCount = prevSeg?.highlights?.length ?? 0;
						if (prevHighlightCount > 0) {
							pendingHighlightStart = prevHighlightCount - 1;
						}
						if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
						if (abortTTS) { abortTTS(); abortTTS = undefined; }
						sidebar.sendAudioStop();
						walkthrough.prev(); // emits "segment" → pendingHighlightStart used
						break;
					}
					const prevIdx = curIdx - 1;
					highlightLoopGeneration++;
					if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
					if (abortTTS) { abortTTS(); abortTTS = undefined; }
					sidebar.sendAudioStop();
					walkthrough.setHighlightIndex(prevIdx);
					if (walkthrough.getState().status === "playing") {
						playSegmentHighlights(seg, walkthrough, sidebar, prevIdx).catch((err) => {
							console.error("[code-explainer] Highlight loop error:", err);
						});
					} else {
						sidebar.sendHighlightAdvance(prevIdx, seg.highlights.length, seg.highlights[prevIdx].explanation);
						highlightSubRange(seg.file, seg.highlights[prevIdx].start, seg.highlights[prevIdx].end, seg.highlights).catch(() => {});
					}
				}
				break;
			}
			case "next":
				if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
				if (abortTTS) { abortTTS(); abortTTS = undefined; }
				sidebar.sendAudioStop();
				walkthrough.next();
				break;
			case "prev":
				if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
				if (abortTTS) { abortTTS(); abortTTS = undefined; }
				sidebar.sendAudioStop();
				walkthrough.prev();
				break;
			case "goto_segment":
				if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
				if (abortTTS) { abortTTS(); abortTTS = undefined; }
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
				if (abortTTS) { abortTTS(); abortTTS = undefined; }
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
