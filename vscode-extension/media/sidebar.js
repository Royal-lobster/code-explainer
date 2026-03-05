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
// Speed is handled by TTS server; Web Audio plays at 1x
let volume = 0.8;
let muted = false;
let audioPlaying = false;
let currentHighlightIndex = 0;
let totalHighlights = 0;
/** True while waiting for the first highlight_advance after a segment change */
let awaitingHighlightAdvance = false;
/** True when audio_end arrived but chunks are still pending (AudioContext suspended) */
let deferredPlaybackComplete = false;

/** @type {{base64: string, sampleRate: number}[]} */
let pendingChunks = [];

function ensureAudioContext() {
	if (!audioCtx) {
		audioCtx = new AudioContext({ sampleRate: 24000 });
		gainNode = audioCtx.createGain();
		gainNode.gain.value = muted ? 0 : volume;
		gainNode.connect(audioCtx.destination);
	}
	if (audioCtx.state === "suspended") {
		audioCtx.resume().then(() => {
			// Flush any chunks that arrived while suspended
			const chunks = pendingChunks.slice();
			pendingChunks = [];
			for (const chunk of chunks) {
				playAudioChunk(chunk.base64, chunk.sampleRate);
			}
			// If audio_end arrived while suspended, now handle deferred playback completion
			if (deferredPlaybackComplete) {
				deferredPlaybackComplete = false;
				waitForActiveSourcesToFinish();
			}
		});
	}
}

// Pre-warm AudioContext on first user interaction so it's ready when audio arrives
document.addEventListener("click", () => ensureAudioContext(), { once: true });


function playAudioChunk(base64Data, sampleRate) {
	ensureAudioContext();

	// If AudioContext is still suspended (no user gesture yet), queue the chunk
	if (audioCtx.state === "suspended") {
		pendingChunks.push({ base64: base64Data, sampleRate });
		return;
	}

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
	source.playbackRate.value = 1;
	source.connect(gainNode);

	const now = audioCtx.currentTime;
	if (nextPlayTime < now) nextPlayTime = now;
	source.start(nextPlayTime);
	nextPlayTime += buffer.duration;

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
	pendingChunks = [];
	nextPlayTime = 0;
	audioPlaying = false;
	deferredPlaybackComplete = false;
}

/**
 * Wait for all active audio sources to finish, then send playback_complete.
 * If no sources are active (already drained), sends immediately.
 */
function waitForActiveSourcesToFinish() {
	if (activeSources.length === 0) {
		audioPlaying = false;
		vscode.postMessage({ type: "playback_complete" });
		return;
	}
	const lastSource = activeSources[activeSources.length - 1];
	const originalOnEnded = lastSource.onended;
	lastSource.onended = (e) => {
		if (originalOnEnded) originalOnEnded.call(lastSource, e);
		audioPlaying = false;
		vscode.postMessage({ type: "playback_complete" });
	};
}

function onAudioEnd() {
	// Multi-highlight mode: wait for actual Web Audio playback to finish,
	// then signal the extension so it can advance to the next sub-highlight.
	if (totalHighlights >= 1) {
		// If chunks are still pending (AudioContext suspended), defer until they're flushed
		if (pendingChunks.length > 0) {
			deferredPlaybackComplete = true;
			return;
		}
		waitForActiveSourcesToFinish();
		return;
	}

	// If AudioContext is suspended (no user gesture yet), chunks are queued
	// but nothing actually played — don't auto-advance.
	if (!audioCtx || audioCtx.state === "suspended") {
		audioPlaying = false;
		return;
	}

	// If an update just reset totalHighlights and we haven't received
	// highlight_advance yet, this audio_end is stale (from the previous
	// segment). Don't auto-advance — the new segment's highlights will
	// arrive shortly.
	if (awaitingHighlightAdvance) {
		audioPlaying = false;
		return;
	}

	// Legacy single-highlight: auto-advance to next segment
	if (activeSources.length === 0) {
		autoAdvance();
		return;
	}
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

function showDoneView() {
	document.getElementById("idle-view").style.display = "none";
	document.getElementById("active-view").style.display = "none";
	document.getElementById("done-view").style.display = "";
	document.getElementById("done-summary").textContent =
		`${state.segments.length} segments covered`;
}

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
		idleView.style.display = "";
		activeView.style.display = "none";
		doneView.style.display = "none";
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

	// Play/pause button (SVG icon toggle)
	const playBtn = document.getElementById("btn-play-pause");
	const iconPlay = playBtn.querySelector(".icon-play");
	const iconPause = playBtn.querySelector(".icon-pause");
	if (state.status === "playing") {
		iconPlay.style.display = "none";
		iconPause.style.display = "";
	} else {
		iconPlay.style.display = "";
		iconPause.style.display = "none";
	}
	playBtn.title = state.status === "playing" ? "Pause" : "Play";

	// Pulse animation when paused (ready to play)
	if (state.status === "paused") {
		playBtn.classList.add("pulse");
	} else {
		playBtn.classList.remove("pulse");
	}

	// Progress bar
	const progressFill = document.getElementById("progress-fill");
	if (progressFill && state.segments.length > 0) {
		const pct = ((idx + 1) / state.segments.length) * 100;
		progressFill.style.width = `${pct}%`;
	}

	// Explanation with fade transition
	if (seg) {
		const explEl = document.getElementById("explanation-text");
		explEl.classList.add("fade-out");
		setTimeout(() => {
			explEl.innerHTML = simpleMarkdown(seg.explanation);
			explEl.classList.remove("fade-out");
		}, 150);
	}

	// Outline
	renderOutline(idx);
}

function renderHighlightProgress() {
	const counter = document.getElementById("segment-counter");
	if (!counter) return;

	const idx = state.segments.findIndex((s) => s.id === state.currentSegment);

	const prevHighlightBtn = document.getElementById("btn-prev-highlight");
	const nextHighlightBtn = document.getElementById("btn-next-highlight");

	if (totalHighlights > 1) {
		counter.textContent =
			`${idx + 1}/${state.segments.length} · ${currentHighlightIndex + 1}/${totalHighlights}`;
		prevHighlightBtn.style.display = "";
		nextHighlightBtn.style.display = "";
	} else {
		counter.textContent = `${idx + 1}/${state.segments.length}`;
		prevHighlightBtn.style.display = "none";
		nextHighlightBtn.style.display = "none";
	}
}

/** Track segment IDs used for the last full outline build */
let outlineSegmentIds = [];

function renderOutline(currentIdx) {
	const list = document.getElementById("outline-list");

	// Check if segments changed (added/removed/reordered) — if so, full rebuild
	const currentIds = state.segments.map((s) => s.id);
	const needsRebuild =
		currentIds.length !== outlineSegmentIds.length ||
		currentIds.some((id, i) => id !== outlineSegmentIds[i]);

	if (needsRebuild) {
		list.innerHTML = "";
		outlineSegmentIds = currentIds;

		for (let i = 0; i < state.segments.length; i++) {
			const seg = state.segments[i];
			const li = document.createElement("li");

			const marker = document.createElement("span");
			marker.className = "marker";

			const text = document.createElement("span");
			text.textContent = `${i + 1}. ${seg.title}`;

			li.appendChild(marker);
			li.appendChild(text);
			// Use pointerdown instead of click — fires immediately on press,
			// preventing races with outline rebuilds or layout shifts.
			li.addEventListener("pointerdown", (e) => {
				e.preventDefault();
				vscode.postMessage({ type: "goto_segment", segmentId: seg.id });
			});
			list.appendChild(li);
		}
	}

	// Update classes and markers in-place (no DOM destruction)
	const items = list.children;
	for (let i = 0; i < items.length; i++) {
		const li = items[i];
		if (i === currentIdx) li.className = "current";
		else if (i < currentIdx) li.className = "completed";
		else li.className = "";

		const marker = li.querySelector(".marker");
		if (i < currentIdx) marker.textContent = "\u2713";
		else if (i === currentIdx) marker.textContent = "\u25B6";
		else marker.textContent = "\u25CB";
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
	ensureAudioContext(); // Unlock AudioContext synchronously during user gesture
	vscode.postMessage({ type: "play_pause" });
});

document.getElementById("btn-next").addEventListener("click", () => {
	vscode.postMessage({ type: "next" });
});

document.getElementById("btn-prev").addEventListener("click", () => {
	vscode.postMessage({ type: "prev" });
});

document.getElementById("btn-next-highlight").addEventListener("click", () => {
	vscode.postMessage({ type: "next_highlight" });
});

document.getElementById("btn-prev-highlight").addEventListener("click", () => {
	vscode.postMessage({ type: "prev_highlight" });
});

document.getElementById("btn-restart").addEventListener("click", () => {
	vscode.postMessage({ type: "restart" });
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
		const speed = parseFloat(btn.dataset.speed);
		document.querySelectorAll("#speed-buttons button").forEach((b) =>
			b.classList.remove("active"),
		);
		btn.classList.add("active");
		vscode.postMessage({ type: "speed_change", speed });
	});
});

// ── Message handler from extension ──

window.addEventListener("message", (event) => {
	const msg = event.data;

	switch (msg.type) {
		case "server_loading": {
			const btn = document.getElementById("btn-play-pause");
			if (msg.loading) {
				btn.classList.add("loading");
				btn.setAttribute("aria-busy", "true");
				btn.setAttribute("aria-disabled", "true");
			} else {
				btn.classList.remove("loading");
				btn.removeAttribute("aria-busy");
				btn.removeAttribute("aria-disabled");
			}
			break;
		}

		case "highlight_advance":
			currentHighlightIndex = msg.highlightIndex;
			totalHighlights = msg.totalHighlights;
			awaitingHighlightAdvance = false;
			renderHighlightProgress();
			break;

		case "update":
			state = {
				title: msg.title,
				segments: msg.segments,
				currentSegment: msg.currentSegment,
				status: msg.status,
			};
			currentHighlightIndex = 0;
			totalHighlights = 0;
			awaitingHighlightAdvance = state.status === "playing";
			render();
			renderHighlightProgress();
			break;

		case "audio_chunk": {
			const playBtn = document.getElementById("btn-play-pause");
			playBtn.classList.remove("loading");
			playBtn.removeAttribute("aria-busy");
			playBtn.removeAttribute("aria-disabled");
			playAudioChunk(msg.data, msg.sampleRate);
			break;
		}

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
