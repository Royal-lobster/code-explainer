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
			for (const chunk of pendingChunks) {
				playAudioChunk(chunk.base64, chunk.sampleRate);
			}
			pendingChunks = [];
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
}

function onAudioEnd() {
	// Multi-highlight mode: wait for actual Web Audio playback to finish,
	// then signal the extension so it can advance to the next sub-highlight.
	if (totalHighlights >= 1) {
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
		// If audio is still playing, wait for it to finish before showing done view
		if (activeSources.length > 0) {
			const lastSource = activeSources[activeSources.length - 1];
			const originalOnEnded = lastSource.onended;
			lastSource.onended = (e) => {
				if (originalOnEnded) originalOnEnded.call(lastSource, e);
				showDoneView();
			};
			return;
		}
		showDoneView();
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

function renderHighlightProgress() {
	const counter = document.getElementById("segment-counter");
	if (!counter) return;

	const idx = state.segments.findIndex((s) => s.id === state.currentSegment);

	if (totalHighlights > 1) {
		counter.textContent =
			`${idx + 1}/${state.segments.length} · ${currentHighlightIndex + 1}/${totalHighlights}`;
	} else {
		counter.textContent = `${idx + 1}/${state.segments.length}`;
	}
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
	ensureAudioContext(); // Unlock AudioContext synchronously during user gesture
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

document.getElementById("btn-restart").addEventListener("click", () => {
	vscode.postMessage({ type: "restart" });
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
