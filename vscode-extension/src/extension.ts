import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Walkthrough } from "./walkthrough";
import { ExplainerServer } from "./server";
import { SidebarProvider } from "./sidebar";
import { WalkthroughStorage } from "./storage";
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

	let storage: WalkthroughStorage | undefined;
	if (wsFolder) {
		storage = new WalkthroughStorage(wsFolder);
		server.setStorage(storage);
	}

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

	// TTS settings — updated by webview messages
	let ttsVoice = "af_heart";
	let ttsSpeed = 1;
	let walkthroughSaved = false;

	let currentChunkAbort: (() => void) | undefined;
	let highlightLoopGeneration = 0;
	// When navigating prev_highlight across segment boundary, we want to start
	// from the last highlight of the previous segment instead of the default 0.
	let pendingHighlightStart: number | undefined;
	// True when audio was suspended (not stopped) during pause — allows exact-position resume
	let hasSuspendedAudio = false;

	/** Stop audio and reset suspended flag. Use this instead of sidebar.sendAudioStop() directly. */
	function fullAudioStop(): void {
		sidebar.sendAudioStop();
		hasSuspendedAudio = false;
	}

	/** Resume from suspended audio — plays remaining buffered audio, then continues to next highlight. */
	function resumeFromSuspended(): void {
		hasSuspendedAudio = false;
		const seg = walkthrough.getCurrentSegment();
		if (!seg) return;
		highlightLoopGeneration++;
		const myGeneration = highlightLoopGeneration;
		const highlightIdx = walkthrough.getHighlightIndex();

		sidebar.sendAudioResume();

		// Wait for the remaining buffered audio to finish.
		// Order matters: sendAudioResume posts to webview (always async via iframe postMessage),
		// so the playback_complete response will arrive after waitForPlaybackComplete installs its resolver.
		sidebar.waitForPlaybackComplete().then(() => {
			if (myGeneration !== highlightLoopGeneration) return;
			if (walkthrough.getState().status !== "playing") return;

			// Continue from the next highlight
			const nextIdx = highlightIdx + 1;
			if (nextIdx < seg.highlights.length) {
				playSegmentHighlights(seg, walkthrough, sidebar, nextIdx).catch((err) => {
					console.error("[code-explainer] Highlight loop error:", err);
				});
			} else {
				// All highlights done — auto-advance to next segment
				walkthrough.next();
			}
		});
	}

	/** Pre-warm the TTS server then resume playback from a specific highlight index. */
	function preWarmAndResume(startHighlight: number): void {
		const seg = walkthrough.getCurrentSegment();
		if (!seg) return;
		highlightLoopGeneration++;
		if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
		fullAudioStop();
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
			await highlightSegmentRange(segment.file, segment.start, segment.end).catch(() => {});
			sb.updateState(wt.getState());
			return;
		}

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
		fullAudioStop();

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
			highlightLoopGeneration++;
			// On pause, suspend audio (freeze in place) for exact-position resume.
			// On "stopped" (natural end), let webview audio drain naturally.
			if (state.status === "paused") {
				sidebar.sendAudioSuspend();
				hasSuspendedAudio = true;
			}
		}

		if (state.status === "stopped") {
			hasSuspendedAudio = false;
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
				if (hasSuspendedAudio) {
					resumeFromSuspended();
				} else {
					preWarmAndResume(walkthrough.getHighlightIndex());
				}
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
				fullAudioStop();
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
				fullAudioStop();
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
			fullAudioStop();
			walkthrough.next();
		}),
		vscode.commands.registerCommand('codeExplainer.prevSegment', () => {
			if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
			fullAudioStop();
			walkthrough.prev();
		}),
		vscode.commands.registerCommand('codeExplainer.stop', () => {
			fullAudioStop();
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
		vscode.commands.registerCommand('codeExplainer.saveWalkthrough', async () => {
			if (!storage) {
				vscode.window.showErrorMessage("No workspace folder open");
				return;
			}
			const state = walkthrough.getState();
			if (state.segments.length === 0) {
				vscode.window.showWarningMessage("No active walkthrough to save");
				return;
			}
			const defaultName = WalkthroughStorage.slugify(state.title);
			const name = await vscode.window.showInputBox({
				prompt: "Walkthrough name",
				value: defaultName,
				validateInput: (v) => v.trim() ? null : "Name cannot be empty",
			});
			if (!name) return;
			if (await storage.exists(name)) {
				const overwrite = await vscode.window.showWarningMessage(
					`"${name}" already exists. Overwrite?`,
					"Overwrite", "Cancel"
				);
				if (overwrite !== "Overwrite") return;
			}
			await storage.save(state.title, state.segments, name);
			walkthroughSaved = true;
			vscode.window.showInformationMessage(`Walkthrough saved to .walkthroughs/${name}.json`);
		}),
		vscode.commands.registerCommand('codeExplainer.loadWalkthrough', async () => {
			if (!storage) {
				vscode.window.showErrorMessage("No workspace folder open");
				return;
			}
			const items = await storage.list();
			if (items.length === 0) {
				vscode.window.showInformationMessage("No saved walkthroughs found in .walkthroughs/");
				return;
			}
			const pick = await vscode.window.showQuickPick(
				items.map((item) => ({
					label: item.title,
					description: item.name,
				})),
				{ placeHolder: "Select a walkthrough to load" }
			);
			if (!pick) return;
			const data = await storage.load(pick.description!);
			if (!data) {
				vscode.window.showErrorMessage("Failed to load walkthrough");
				return;
			}
			walkthrough.setPlan(data.title, data.segments);
			sidebar.reveal();
		}),
	);

	// ── Agent messages → walkthrough state ──

	server.setMessageHandler((msg: AgentMessage) => {
		switch (msg.type) {
			case "set_plan":
				walkthroughSaved = false;
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
				if (hasSuspendedAudio) {
					resumeFromSuspended();
				} else {
					preWarmAndResume(resumeHighlightIdx);
				}
				break;
			}
			case "stop":
				fullAudioStop();
				walkthrough.stop();
				break;
		}
	});

	// ── Webview messages → walkthrough state + server ──

	sidebar.setMessageHandler(async (msg: FromWebviewMessage) => {
		switch (msg.type) {
			case "play_pause":
				walkthrough.togglePlayPause();
				// If resuming, try to resume suspended audio first for exact-position resume
				if (walkthrough.getState().status === "playing") {
					if (hasSuspendedAudio) {
						resumeFromSuspended();
					} else {
						preWarmAndResume(walkthrough.getHighlightIndex());
					}
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
								fullAudioStop();
						walkthrough.next(); // emits "segment" → starts from highlight 0
						break;
					}
					const nextIdx = curIdx + 1;
					highlightLoopGeneration++;
					if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
					fullAudioStop();
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
								fullAudioStop();
						walkthrough.prev(); // emits "segment" → pendingHighlightStart used
						break;
					}
					const prevIdx = curIdx - 1;
					highlightLoopGeneration++;
					if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
					fullAudioStop();
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
				fullAudioStop();
				walkthrough.next();
				break;
			case "prev":
				if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
				fullAudioStop();
				walkthrough.prev();
				break;
			case "goto_segment":
				if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
				fullAudioStop();
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
				fullAudioStop();
				const segments = walkthrough.getState().segments;
				if (segments.length > 0) {
					walkthrough.goto(segments[0].id);
				}
				break;
			}
			case "save":
				vscode.commands.executeCommand('codeExplainer.saveWalkthrough');
				break;
			case "load":
				if (storage) {
					const data = await storage.load(msg.name);
					if (data) {
						walkthroughSaved = true;
						walkthrough.setPlan(data.title, data.segments);
						sidebar.reveal();
					}
				}
				break;
			case "request_saved_list":
				if (storage) {
					const list = await storage.list();
					sidebar.postMessage({
						type: "saved_list",
						walkthroughs: list.map(({ name, title }) => ({ name, title })),
					});
				}
				break;
			case "close_walkthrough": {
				const wtState = walkthrough.getState();
				if (wtState.status !== "idle" && wtState.status !== "stopped" && !walkthroughSaved) {
					const choice = await vscode.window.showWarningMessage(
						"This walkthrough hasn't been saved. Close anyway?",
						{ modal: true, detail: "You can re-generate it by asking your coding agent to send the walkthrough again." },
						"Save & Close",
						"Close Without Saving",
					);
					if (!choice) break; // dismissed
					if (choice === "Save & Close") {
						await vscode.commands.executeCommand('codeExplainer.saveWalkthrough');
					}
				}
				if (currentChunkAbort) { currentChunkAbort(); currentChunkAbort = undefined; }
				fullAudioStop();
				walkthrough.stop();
				walkthroughSaved = false;
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
			restoreSmoothScrolling().catch(() => {});
			disposeHighlights();
		},
	});
}

export function deactivate(): void {}
