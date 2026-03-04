// ── Walkthrough data ──

export interface Highlight {
	start: number;   // 1-based line number
	end: number;     // 1-based line number
	ttsText: string; // narration for these specific lines
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

// ── Claude → Extension messages (HTTP + WS) ──

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

export type ClaudeMessage =
	| SetPlanMessage
	| InsertAfterMessage
	| ReplaceSegmentMessage
	| RemoveSegmentsMessage
	| GotoMessage
	| ResumeMessage
	| StopMessage;

// ── Extension → Claude messages ──

export type WalkthroughStatus = "playing" | "paused" | "stopped" | "idle";

export interface StateMessage {
	type: "state";
	currentSegment: number;
	status: WalkthroughStatus;
	totalSegments: number;
}

export interface UserActionMessage {
	type: "user_action";
	action: "go_deeper" | "zoom_out" | "ask_question";
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
}

export type ToWebviewMessage =
	| WebviewUpdateMessage
	| WebviewAudioChunkMessage
	| WebviewAudioEndMessage
	| WebviewAudioStopMessage
	| WebviewHighlightAdvanceMessage;

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

export interface WebviewGoDeeperMessage {
	type: "go_deeper";
}

export interface WebviewZoomOutMessage {
	type: "zoom_out";
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

export type FromWebviewMessage =
	| WebviewPlayPauseMessage
	| WebviewNextMessage
	| WebviewPrevMessage
	| WebviewGotoSegmentMessage
	| WebviewGoDeeperMessage
	| WebviewZoomOutMessage
	| WebviewSpeedChangeMessage
	| WebviewVolumeChangeMessage
	| WebviewVoiceChangeMessage
	| WebviewMuteToggleMessage
	| WebviewRestartMessage;
