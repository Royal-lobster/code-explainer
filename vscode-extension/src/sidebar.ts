import * as vscode from "vscode";
import type { ToWebviewMessage, FromWebviewMessage } from "./types";
import type { WalkthroughState } from "./walkthrough";

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "codeExplainer.sidebar";

	private view?: vscode.WebviewView;
	private onMessage?: (msg: FromWebviewMessage) => void;
	private playbackCompleteResolve?: () => void;

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
			if (msg.type === "playback_complete") {
				this.playbackCompleteResolve?.();
				this.playbackCompleteResolve = undefined;
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

	/** Returns a promise that resolves when the webview signals playback is done */
	waitForPlaybackComplete(): Promise<void> {
		return new Promise((resolve) => {
			this.playbackCompleteResolve = resolve;
		});
	}

	sendHighlightAdvance(highlightIndex: number, totalHighlights: number): void {
		this.postMessage({
			type: "highlight_advance",
			highlightIndex,
			totalHighlights,
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
		<p class="idle-text">Waiting for walkthrough...</p>
		<p class="idle-hint">Run <code>/explainer</code> in your coding agent to start</p>
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
