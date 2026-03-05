// ── Walkthrough data ──

export interface Highlight {
	start: number;   // 1-based line number
	end: number;     // 1-based line number
	ttsText: string; // narration for these specific lines
	explanation?: string; // optional per-highlight explanation
}

export interface Segment {
	id: number;
	file: string;
	start: number;
	end: number;
	title: string;
	explanation: string;
	ttsText: string;
	highlights?: Highlight[];
}

// ── Agent → Extension messages (HTTP + WS) ──

export interface SetPlanMessage {
	type: "set_plan";
	title: string;
	segments: Segment[];
}

export interface InsertAfterMessage {
	type: "insert_after";
	afterSegment: number;
	segments: Segment[];
}

export interface ReplaceSegmentMessage {
	type: "replace_segment";
	id: number;
	segment: Segment;
}

export interface RemoveSegmentsMessage {
	type: "remove_segments";
	ids: number[];
}

export interface GotoMessage {
	type: "goto";
	segmentId: number;
}

export interface ResumeMessage {
	type: "resume";
}

export interface StopMessage {
	type: "stop";
}

export type AgentMessage =
	| SetPlanMessage
	| InsertAfterMessage
	| ReplaceSegmentMessage
	| RemoveSegmentsMessage
	| GotoMessage
	| ResumeMessage
	| StopMessage;

// ── Extension → Agent messages ──

export type WalkthroughStatus = "playing" | "paused" | "stopped" | "idle";

export interface StateMessage {
	type: "state";
	currentSegment: number;
	status: WalkthroughStatus;
	totalSegments: number;
}

export interface UserActionMessage {
	type: "user_action";
	action: "ask_question";
	segmentId: number;
	question?: string;
}

export type ExtensionMessage = StateMessage | UserActionMessage;

// ── Extension ↔ Webview messages ──

export interface WebviewUpdateMessage {
	type: "update";
	title: string;
	segments: Segment[];
	currentSegment: number;
	status: WalkthroughStatus;
}

export interface WebviewAudioChunkMessage {
	type: "audio_chunk";
	data: string; // base64-encoded float32 PCM
	sampleRate: number;
}

export interface WebviewAudioEndMessage {
	type: "audio_end";
}

export interface WebviewAudioStopMessage {
	type: "audio_stop";
}

export interface WebviewHighlightAdvanceMessage {
	type: "highlight_advance";
	highlightIndex: number;
	totalHighlights: number;
	explanation?: string;
}

export interface WebviewServerLoadingMessage {
	type: "server_loading";
	loading: boolean;
}

export type ToWebviewMessage =
	| WebviewUpdateMessage
	| WebviewAudioChunkMessage
	| WebviewAudioEndMessage
	| WebviewAudioStopMessage
	| WebviewHighlightAdvanceMessage
	| WebviewServerLoadingMessage;

export interface WebviewPlayPauseMessage {
	type: "play_pause";
}

export interface WebviewNextMessage {
	type: "next";
}

export interface WebviewPrevMessage {
	type: "prev";
}

export interface WebviewGotoSegmentMessage {
	type: "goto_segment";
	segmentId: number;
}

export interface WebviewSpeedChangeMessage {
	type: "speed_change";
	speed: number;
}

export interface WebviewVolumeChangeMessage {
	type: "volume_change";
	volume: number;
}

export interface WebviewVoiceChangeMessage {
	type: "voice_change";
	voice: string;
}

export interface WebviewMuteToggleMessage {
	type: "mute_toggle";
}

export interface WebviewRestartMessage {
	type: "restart";
}

export interface WebviewNextHighlightMessage {
	type: "next_highlight";
}

export interface WebviewPrevHighlightMessage {
	type: "prev_highlight";
}

export interface WebviewPlaybackCompleteMessage {
	type: "playback_complete";
}

export type FromWebviewMessage =
	| WebviewPlayPauseMessage
	| WebviewNextMessage
	| WebviewPrevMessage
	| WebviewGotoSegmentMessage
	| WebviewSpeedChangeMessage
	| WebviewVolumeChangeMessage
	| WebviewVoiceChangeMessage
	| WebviewMuteToggleMessage
	| WebviewRestartMessage
	| WebviewPlaybackCompleteMessage
	| WebviewNextHighlightMessage
	| WebviewPrevHighlightMessage;
