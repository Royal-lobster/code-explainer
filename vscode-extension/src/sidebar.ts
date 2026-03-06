import * as vscode from "vscode";
import type { ToWebviewMessage, FromWebviewMessage } from "./types";
import type { WalkthroughState } from "./walkthrough";

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "codeExplainer.sidebar";

	private view?: vscode.WebviewView;
	private onMessage?: (msg: FromWebviewMessage) => void | Promise<void>;
	private playbackCompleteResolve?: () => void;
	private chunkPlayedCallback?: () => void;

	constructor(private readonly extensionUri: vscode.Uri) {}

	setMessageHandler(handler: (msg: FromWebviewMessage) => void | Promise<void>): void {
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
			if (msg.type === "playback_complete") {
				this.playbackCompleteResolve?.();
				this.playbackCompleteResolve = undefined;
				return;
			}
			if (msg.type === "chunk_played") {
				this.chunkPlayedCallback?.();
				return;
			}
			this.onMessage?.(msg);
		});
	}

	/** Reveal and focus the sidebar panel */
	reveal(): void {
		if (this.view) {
			this.view.show?.(true);
		} else {
			// If webview isn't resolved yet, open the sidebar view
			vscode.commands.executeCommand("codeExplainer.sidebar.focus");
		}
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
		// Resolve any pending playback wait since audio was forcefully stopped
		this.playbackCompleteResolve?.();
		this.playbackCompleteResolve = undefined;
	}

	/** Suspend audio in webview (freeze in place for mid-highlight pause). */
	sendAudioSuspend(): void {
		this.postMessage({ type: "audio_suspend" });
		// Resolve any pending playback wait so the old highlight loop can exit
		this.playbackCompleteResolve?.();
		this.playbackCompleteResolve = undefined;
	}

	/** Resume suspended audio in webview. */
	sendAudioResume(): void {
		this.postMessage({ type: "audio_resume" });
	}

	/** Returns a promise that resolves when the webview signals playback is done */
	waitForPlaybackComplete(): Promise<void> {
		// Resolve any dangling previous wait to prevent leaked promises
		this.playbackCompleteResolve?.();
		return new Promise((resolve) => {
			this.playbackCompleteResolve = resolve;
		});
	}

	/** Register a callback fired each time the webview finishes playing one audio chunk. */
	setChunkPlayedCallback(cb: (() => void) | undefined): void {
		this.chunkPlayedCallback = cb;
	}

	sendServerLoading(loading: boolean): void {
		this.postMessage({ type: "server_loading", loading });
	}

	sendHighlightAdvance(highlightIndex: number, totalHighlights: number, explanation?: string): void {
		this.postMessage({
			type: "highlight_advance",
			highlightIndex,
			totalHighlights,
			explanation,
		});
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
		<div class="idle-header">
			<span class="idle-header-label">CODE EXPLAINER</span>
		</div>
		<div class="idle-hero">
			<svg class="idle-icon" width="32" height="32" viewBox="0 0 16 16" fill="currentColor" opacity="0.4">
				<path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5a5.5 5.5 0 110-11 5.5 5.5 0 010 11zM6.5 5v6l5-3-5-3z"/>
			</svg>
			<p class="idle-text">No walkthrough loaded</p>
			<p class="idle-hint">Run <code>/explainer</code> in your coding agent to generate one</p>
		</div>
		<div id="saved-list-section" style="display:none;">
			<h3 class="saved-list-title">Saved Walkthroughs</h3>
			<ul id="saved-list"></ul>
		</div>
	</div>

	<div id="active-view" style="display:none;">
		<div class="sticky-top">
			<div class="header">
				<span class="header-label">CODE EXPLAINER</span>
				<div class="header-actions">
					<button id="btn-save" class="icon-btn" title="Save Walkthrough">
						<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
							<path d="M13.354 4.354l-3.708-3.708A.5.5 0 009.293.5H2.5A1.5 1.5 0 001 2v12a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0015 14V4.707a.5.5 0 00-.146-.353zM12 14H4V9h8v5zm1-7H3V2h6.293L13 5.707V7z"/>
						</svg>
					</button>
					<button id="btn-close" class="icon-btn" title="Close Walkthrough">
						<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
							<path d="M8 8.707l3.646 3.647.708-.708L8.707 8l3.647-3.646-.708-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z"/>
						</svg>
					</button>
				</div>
			</div>
			<h2 id="walkthrough-title"></h2>

			<div class="now-playing">
				<div class="progress-bar"><div id="progress-fill" class="progress-fill"></div></div>
				<span id="segment-counter" class="counter"></span>
				<span id="segment-title" class="seg-title"></span>
				<a id="segment-location" class="seg-location" href="#"></a>
			</div>

			<div class="controls">
				<button id="btn-prev" title="Hold Shift to skip entire segment">
					<svg class="icon-highlight" width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M10 2L4 8l6 6V2z"/></svg>
					<svg class="icon-segment" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="display:none"><path d="M3 3h2v10H3V3zm10 0L7 8l6 5V3z"/></svg>
				</button>
				<button id="btn-play-pause" class="play-btn" title="Play/Pause">
					<svg class="icon-play" width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6V2z"/></svg>
					<svg class="icon-pause" width="18" height="18" viewBox="0 0 16 16" fill="currentColor" style="display:none"><path d="M3 2h4v12H3V2zm6 0h4v12H9V2z"/></svg>
				</button>
				<button id="btn-next" title="Hold Shift to skip entire segment">
					<svg class="icon-highlight" width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6 2l6 6-6 6V2z"/></svg>
					<svg class="icon-segment" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="display:none"><path d="M11 3h2v10h-2V3zM3 3l6 5-6 5V3z"/></svg>
				</button>
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
						<button data-speed="1" class="active">1x</button>
						<button data-speed="1.25">1.25x</button>
						<button data-speed="1.5">1.5x</button>
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

			<div class="agent-hint">
				<span class="agent-hint-icon">&#x1F4AC;</span>
				Have questions? Ask your coding agent!
			</div>
		</div>

		<div class="outline">
			<h3>Outline</h3>
			<ul id="outline-list"></ul>
		</div>
	</div>

	<div id="done-view" style="display:none;">
		<div class="done-card">
			<p class="done-text">Walkthrough complete</p>
			<p id="done-summary" class="done-summary"></p>
			<p class="done-hint">Have more questions? Ask your coding agent!</p>
			<button id="btn-restart" class="done-restart-btn">Restart Walkthrough</button>
		</div>
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
