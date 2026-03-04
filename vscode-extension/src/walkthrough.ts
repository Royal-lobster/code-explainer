import { EventEmitter } from "events";
import type { Segment, WalkthroughStatus } from "./types";

export interface WalkthroughState {
	title: string;
	segments: Segment[];
	currentIndex: number;
	currentHighlightIndex: number;
	status: WalkthroughStatus;
}

/**
 * Manages walkthrough plan state, segment navigation, and plan mutations.
 *
 * Events:
 *   "segment"  — fired when current segment changes (arg: Segment)
 *   "plan"     — fired when plan is set or mutated (arg: WalkthroughState)
 *   "status"   — fired when status changes (arg: WalkthroughStatus)
 */
export class Walkthrough extends EventEmitter {
	private state: WalkthroughState = {
		title: "",
		segments: [],
		currentIndex: -1,
		currentHighlightIndex: 0,
		status: "idle",
	};

	getState(): WalkthroughState {
		return { ...this.state, segments: [...this.state.segments] };
	}

	getCurrentSegment(): Segment | undefined {
		return this.state.segments[this.state.currentIndex];
	}

	// ── Plan lifecycle ──

	setPlan(title: string, segments: Segment[]): void {
		this.state = { title, segments, currentIndex: 0, currentHighlightIndex: 0, status: "paused" };
		this.emit("plan", this.getState());
		this.emit("status", this.state.status);
	}

	stop(): void {
		this.state.status = "stopped";
		this.emit("status", this.state.status);
	}

	// ── Navigation ──

	play(): void {
		if (this.state.status === "paused") {
			this.state.status = "playing";
			this.emit("status", this.state.status);
		}
	}

	pause(): void {
		if (this.state.status === "playing") {
			this.state.status = "paused";
			this.emit("status", this.state.status);
		}
	}

	togglePlayPause(): void {
		if (this.state.status === "playing") {
			this.pause();
		} else if (this.state.status === "paused") {
			this.play();
		}
	}

	next(): boolean {
		const nextIdx = this.state.currentIndex + 1;
		if (nextIdx >= this.state.segments.length) {
			this.state.status = "stopped";
			this.emit("status", this.state.status);
			return false;
		}
		this.state.currentIndex = nextIdx;
		this.state.currentHighlightIndex = 0;
		this.state.status = "playing";
		this.emit("status", this.state.status);
		this.emit("segment", this.state.segments[nextIdx]);
		return true;
	}

	prev(): boolean {
		const prevIdx = this.state.currentIndex - 1;
		if (prevIdx < 0) return false;
		this.state.currentIndex = prevIdx;
		this.state.currentHighlightIndex = 0;
		this.state.status = "playing";
		this.emit("status", this.state.status);
		this.emit("segment", this.state.segments[prevIdx]);
		return true;
	}

	goto(segmentId: number): boolean {
		const idx = this.state.segments.findIndex((s) => s.id === segmentId);
		if (idx === -1) return false;
		this.state.currentIndex = idx;
		this.state.currentHighlightIndex = 0;
		this.state.status = "playing";
		this.emit("status", this.state.status);
		this.emit("segment", this.state.segments[idx]);
		return true;
	}

	// ── Plan mutations ──

	insertAfter(afterSegmentId: number, newSegments: Segment[]): void {
		const idx = this.state.segments.findIndex((s) => s.id === afterSegmentId);
		if (idx === -1) return;
		this.state.segments.splice(idx + 1, 0, ...newSegments);
		// Adjust currentIndex if insertion is before current position
		if (idx < this.state.currentIndex) {
			this.state.currentIndex += newSegments.length;
		}
		this.emit("plan", this.getState());
	}

	replaceSegment(id: number, segment: Segment): void {
		const idx = this.state.segments.findIndex((s) => s.id === id);
		if (idx === -1) return;
		this.state.segments[idx] = segment;
		this.emit("plan", this.getState());
		// If replacing the current segment, re-emit it
		if (idx === this.state.currentIndex) {
			this.emit("segment", segment);
		}
	}

	removeSegments(ids: number[]): void {
		const idSet = new Set(ids);
		const currentSegment = this.getCurrentSegment();
		this.state.segments = this.state.segments.filter((s) => !idSet.has(s.id));
		// Try to maintain current segment
		if (currentSegment && !idSet.has(currentSegment.id)) {
			this.state.currentIndex = this.state.segments.findIndex(
				(s) => s.id === currentSegment.id,
			);
		} else if (this.state.segments.length === 0) {
			this.state.currentIndex = -1;
			this.state.status = "idle";
			this.emit("status", this.state.status);
		} else {
			this.state.currentIndex = Math.min(
				this.state.currentIndex,
				this.state.segments.length - 1,
			);
		}
		this.emit("plan", this.getState());
	}
}
