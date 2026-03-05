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
		// Clear onended BEFORE stopping to prevent stale playback_complete messages.
		// Without this, wrapped onended callbacks (from waitForActiveSourcesToFinish)
		// fire and send playback_complete which can resolve the NEXT chunk's promise,
		// causing the highlight loop to skip subsegments and leak orphaned TTS streams.
		source.onended = null;
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

function computeGlobalProgress() {
	if (state.segments.length === 0) {
		return { current: 0, total: 0 };
	}
	let totalGlobalHighlights = 0;
	let completedHighlights = 0;
	const currentIdx = state.segments.findIndex(s => s.id === state.currentSegment);

	for (let i = 0; i < state.segments.length; i++) {
		const seg = state.segments[i];
		const segHighlights = (seg.highlights && seg.highlights.length > 0) ? seg.highlights.length : 1;
		totalGlobalHighlights += segHighlights;

		if (i < currentIdx) {
			completedHighlights += segHighlights;
		} else if (i === currentIdx) {
			completedHighlights += currentHighlightIndex;
		}
	}

	return { current: completedHighlights + 1, total: totalGlobalHighlights };
}

function renderHighlightProgress() {
	const counter = document.getElementById("segment-counter");
	if (!counter) return;

	const { current, total } = computeGlobalProgress();
	if (total > 0) {
		counter.textContent = `${current}/${total}`;
	} else {
		counter.textContent = "";
	}

	// Update progress bar
	const progressFill = document.getElementById("progress-fill");
	if (progressFill && total > 0) {
		const pct = (current / total) * 100;
		progressFill.style.width = `${pct}%`;
	}

	// Update nav button icons based on current highlight count
	updateNavIcons();
}

/** Track segment IDs used for the last full outline build */
let outlineSegmentIds = [];

function renderOutline(currentIdx) {
	const list = document.getElementById("outline-list");

	const currentIds = state.segments.map(s => s.id);
	const needsRebuild = currentIds.length !== outlineSegmentIds.length ||
		currentIds.some((id, i) => id !== outlineSegmentIds[i]);

	if (needsRebuild) {
		list.innerHTML = "";
		outlineSegmentIds = currentIds;

		for (let i = 0; i < state.segments.length; i++) {
			const seg = state.segments[i];
			const li = document.createElement("li");
			li.className = "outline-segment";

			// Segment header (clickable)
			const header = document.createElement("div");
			header.className = "outline-segment-header";

			const marker = document.createElement("span");
			marker.className = "marker";

			let expandIcon = null;
			if (seg.highlights && seg.highlights.length > 1) {
				expandIcon = document.createElement("span");
				expandIcon.className = "expand-icon";
				expandIcon.textContent = "\u25B8";
			}

			const text = document.createElement("span");
			text.className = "segment-label";
			text.textContent = `${i + 1}. ${seg.title}`;

			header.appendChild(marker);
			if (expandIcon) header.appendChild(expandIcon);
			header.appendChild(text);

			// Clicking header navigates to segment
			header.addEventListener("pointerdown", (e) => {
				e.preventDefault();
				vscode.postMessage({ type: "goto_segment", segmentId: seg.id });
			});

			li.appendChild(header);

			// Nested highlights
			if (seg.highlights && seg.highlights.length > 1) {
				const subList = document.createElement("ul");
				subList.className = "outline-highlights";

				for (let j = 0; j < seg.highlights.length; j++) {
					const hl = seg.highlights[j];
					const subLi = document.createElement("li");
					subLi.className = "outline-highlight";

					const hlMarker = document.createElement("span");
					hlMarker.className = "hl-marker";

					const hlText = document.createElement("span");
					const label = hl.ttsText || `Lines ${hl.start}-${hl.end}`;
					hlText.textContent = label.length > 50 ? label.substring(0, 47) + "..." : label;

					subLi.appendChild(hlMarker);
					subLi.appendChild(hlText);

					subList.appendChild(subLi);
				}

				li.appendChild(subList);
			}

			list.appendChild(li);
		}
	}

	// Update state classes
	const items = list.children;
	for (let i = 0; i < items.length; i++) {
		const li = items[i];
		const header = li.querySelector(".outline-segment-header");
		const expandIcon = li.querySelector(".expand-icon");
		const subList = li.querySelector(".outline-highlights");

		// Update markers and classes
		if (i === currentIdx) {
			header.className = "outline-segment-header current";
		} else if (i < currentIdx) {
			header.className = "outline-segment-header completed";
		} else {
			header.className = "outline-segment-header";
		}

		const marker = li.querySelector(".marker");
		if (i < currentIdx) marker.textContent = "\u2713";
		else if (i === currentIdx) marker.textContent = "\u25B6";
		else marker.textContent = "\u25CB";

		// Expand/collapse
		if (subList) {
			if (i === currentIdx) {
				subList.classList.add("expanded");
				if (expandIcon) expandIcon.textContent = "\u25BE";
			} else {
				subList.classList.remove("expanded");
				if (expandIcon) expandIcon.textContent = "\u25B8";
			}
		}

		// Update highlight markers
		if (subList) {
			const hlItems = subList.children;
			for (let j = 0; j < hlItems.length; j++) {
				const hlMarker = hlItems[j].querySelector(".hl-marker");
				if (i < currentIdx) {
					hlItems[j].className = "outline-highlight completed";
					hlMarker.textContent = "\u2713";
				} else if (i === currentIdx && j < currentHighlightIndex) {
					hlItems[j].className = "outline-highlight completed";
					hlMarker.textContent = "\u2713";
				} else if (i === currentIdx && j === currentHighlightIndex) {
					hlItems[j].className = "outline-highlight current";
					hlMarker.textContent = "\u25B8";
				} else {
					hlItems[j].className = "outline-highlight";
					hlMarker.textContent = "\u00B7";
				}
			}
		}
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

// ── Hold-to-pause (spacebar) ──

let holdPaused = false;

// ── Shift modifier tracking ──

let shiftHeld = false;

function updateNavIcons() {
	const showSegment = shiftHeld || totalHighlights <= 1;
	document.querySelectorAll("#btn-prev, #btn-next").forEach((btn) => {
		const highlightIcon = btn.querySelector(".icon-highlight");
		const segmentIcon = btn.querySelector(".icon-segment");
		if (highlightIcon && segmentIcon) {
			highlightIcon.style.display = showSegment ? "none" : "";
			segmentIcon.style.display = showSegment ? "" : "none";
		}
	});
}

document.addEventListener("keydown", (e) => {
	if (e.key === "Shift" && !shiftHeld) {
		shiftHeld = true;
		updateNavIcons();
	}
	if (e.code === "Space" && !e.repeat) {
		// Don't intercept space on interactive elements
		if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") {
			return;
		}
		e.preventDefault();
		// Only hold-pause if currently playing (not if user-paused)
		if (state.status === "playing" && !holdPaused) {
			holdPaused = true;
			ensureAudioContext();
			vscode.postMessage({ type: "play_pause" });
		}
	}
});

document.addEventListener("keyup", (e) => {
	if (e.key === "Shift") {
		shiftHeld = false;
		updateNavIcons();
	}
	if (e.code === "Space") {
		// Don't intercept space on interactive elements
		if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") {
			return;
		}
		e.preventDefault();
		if (holdPaused) {
			holdPaused = false;
			vscode.postMessage({ type: "play_pause" });
		}
	}
});

window.addEventListener("blur", () => {
	holdPaused = false;
	shiftHeld = false;
	updateNavIcons();
});

// ── Event handlers ──

document.getElementById("btn-play-pause").addEventListener("click", () => {
	ensureAudioContext(); // Unlock AudioContext synchronously during user gesture
	vscode.postMessage({ type: "play_pause" });
});

document.getElementById("btn-next").addEventListener("click", () => {
	if (shiftHeld || totalHighlights <= 1) {
		vscode.postMessage({ type: "next" });
	} else {
		vscode.postMessage({ type: "next_highlight" });
	}
});

document.getElementById("btn-prev").addEventListener("click", () => {
	if (shiftHeld || totalHighlights <= 1) {
		vscode.postMessage({ type: "prev" });
	} else {
		vscode.postMessage({ type: "prev_highlight" });
	}
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

		case "highlight_advance": {
			currentHighlightIndex = msg.highlightIndex;
			totalHighlights = msg.totalHighlights;
			awaitingHighlightAdvance = false;
			renderHighlightProgress();
			const hlIdx = state.segments.findIndex((s) => s.id === state.currentSegment);
			if (hlIdx !== -1) renderOutline(hlIdx);
			break;
		}

		case "update": {
			const prevSegment = state.currentSegment;
			state = {
				title: msg.title,
				segments: msg.segments,
				currentSegment: msg.currentSegment,
				status: msg.status,
			};
			// Only reset highlight state when the segment actually changed
			if (prevSegment !== msg.currentSegment) {
				currentHighlightIndex = 0;
				totalHighlights = 0;
			}
			// If something else resumed playback while spacebar was held, clear the flag
			if (state.status !== "paused") {
				holdPaused = false;
			}
			awaitingHighlightAdvance = state.status === "playing";
			render();
			renderHighlightProgress();
			break;
		}

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
