import * as vscode from "vscode";

// Dim decoration for lines outside the current segment
const dimDecoration = vscode.window.createTextEditorDecorationType({
	opacity: "0.35",
	isWholeLine: true,
});

// Lighter dim for non-active lines within the segment
const segmentDimDecoration = vscode.window.createTextEditorDecorationType({
	opacity: "0.55",
	isWholeLine: true,
});

// Active sub-highlight: soft white glow
const activeDecoration = vscode.window.createTextEditorDecorationType({
	isWholeLine: true,
	backgroundColor: "rgba(255, 255, 255, 0.06)",
	overviewRulerColor: "rgba(255, 190, 60, 0.5)",
	overviewRulerLane: vscode.OverviewRulerLane.Center,
});

// Gap lines: between highlights within a segment (context code, not narrated)
const gapDecoration = vscode.window.createTextEditorDecorationType({
	opacity: "0.55",
	isWholeLine: true,
	borderWidth: "0 0 0 2px",
	borderStyle: "dotted",
	borderColor: "rgba(255, 190, 60, 0.2)",
});

// Track current segment range for computing dim regions
let currentSegmentStart = 0;
let currentSegmentEnd = 0;

/**
 * Build ranges for all lines OUTSIDE [segStart, segEnd].
 */
function buildOuterDimRanges(
	doc: vscode.TextDocument,
	segStart: number,
	segEnd: number,
): vscode.Range[] {
	const ranges: vscode.Range[] = [];
	const lastLine = doc.lineCount - 1;

	for (let i = 0; i < segStart; i++) {
		const line = doc.lineAt(i);
		ranges.push(new vscode.Range(line.range.start, line.range.end));
	}
	for (let i = segEnd + 1; i <= lastLine; i++) {
		const line = doc.lineAt(i);
		ranges.push(new vscode.Range(line.range.start, line.range.end));
	}

	return ranges;
}

/**
 * Build ranges for segment lines EXCLUDING [activeStart, activeEnd].
 */
function buildSegmentDimRanges(
	doc: vscode.TextDocument,
	segStart: number,
	segEnd: number,
	activeStart: number,
	activeEnd: number,
): vscode.Range[] {
	const ranges: vscode.Range[] = [];

	for (let i = segStart; i < activeStart; i++) {
		const line = doc.lineAt(i);
		ranges.push(new vscode.Range(line.range.start, line.range.end));
	}
	for (let i = activeEnd + 1; i <= segEnd; i++) {
		const line = doc.lineAt(i);
		ranges.push(new vscode.Range(line.range.start, line.range.end));
	}

	return ranges;
}

/**
 * Open a file and dim the entire segment range (spotlight mode).
 * Returns the editor for subsequent sub-highlight calls.
 */
export async function highlightSegmentRange(
	filePath: string,
	startLine: number,
	endLine: number,
): Promise<vscode.TextEditor> {
	const zeroStart = Math.max(0, startLine - 1);
	const zeroEnd = Math.max(zeroStart, endLine - 1);

	currentSegmentStart = zeroStart;
	currentSegmentEnd = zeroEnd;

	const uri = vscode.Uri.file(filePath);
	const doc = await vscode.workspace.openTextDocument(uri);
	const editor = await vscode.window.showTextDocument(doc, {
		preview: false,
		preserveFocus: false,
	});

	// Dim everything outside the segment
	const dimRanges = buildOuterDimRanges(doc, zeroStart, zeroEnd);
	editor.setDecorations(dimDecoration, dimRanges);
	// Clear sub-highlight decorations
	editor.setDecorations(segmentDimDecoration, []);
	editor.setDecorations(activeDecoration, []);
	editor.setDecorations(gapDecoration, []);

	const startPos = new vscode.Position(zeroStart, 0);
	const endPos = new vscode.Position(zeroEnd, doc.lineAt(zeroEnd).text.length);
	const range = new vscode.Range(startPos, endPos);
	editor.selection = new vscode.Selection(startPos, startPos);
	editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

	return editor;
}

/**
 * Spotlight a sub-range: undim the active lines, dim the rest, add gold border.
 * The editor must already be open (from highlightSegmentRange).
 */
export async function highlightSubRange(
	filePath: string,
	startLine: number,
	endLine: number,
	allHighlights?: { start: number; end: number }[],
): Promise<void> {
	const zeroStart = Math.max(0, startLine - 1);
	const zeroEnd = Math.max(zeroStart, endLine - 1);

	const uri = vscode.Uri.file(filePath);
	const doc = await vscode.workspace.openTextDocument(uri);
	const editor = await vscode.window.showTextDocument(doc, {
		preview: false,
		preserveFocus: false,
	});

	// Dim outside segment
	const dimRanges = buildOuterDimRanges(doc, currentSegmentStart, currentSegmentEnd);
	editor.setDecorations(dimDecoration, dimRanges);

	// Compute gap vs non-active highlight ranges when we have highlight info
	if (allHighlights && allHighlights.length > 0) {
		const highlightedLines = new Set<number>();
		for (const hl of allHighlights) {
			for (let l = Math.max(0, hl.start - 1); l <= Math.max(0, hl.end - 1); l++) {
				highlightedLines.add(l);
			}
		}

		const gapRanges: vscode.Range[] = [];
		const nonActiveHighlightRanges: vscode.Range[] = [];

		for (let i = currentSegmentStart; i <= currentSegmentEnd; i++) {
			if (i >= zeroStart && i <= zeroEnd) continue; // active highlight
			const line = doc.lineAt(i);
			if (highlightedLines.has(i)) {
				nonActiveHighlightRanges.push(new vscode.Range(line.range.start, line.range.end));
			} else {
				gapRanges.push(new vscode.Range(line.range.start, line.range.end));
			}
		}

		editor.setDecorations(segmentDimDecoration, nonActiveHighlightRanges);
		editor.setDecorations(gapDecoration, gapRanges);
	} else {
		// Fallback: no highlight info, use existing behavior
		const segDimRanges = buildSegmentDimRanges(doc, currentSegmentStart, currentSegmentEnd, zeroStart, zeroEnd);
		editor.setDecorations(segmentDimDecoration, segDimRanges);
		editor.setDecorations(gapDecoration, []);
	}

	// Apply gold border to active lines
	const startPos = new vscode.Position(zeroStart, 0);
	const endPos = new vscode.Position(zeroEnd, doc.lineAt(zeroEnd).text.length);
	const activeRange = new vscode.Range(startPos, endPos);
	editor.setDecorations(activeDecoration, [activeRange]);

	editor.selection = new vscode.Selection(startPos, startPos);
	editor.revealRange(activeRange, vscode.TextEditorRevealType.InCenter);
}

/**
 * Legacy single-range highlight (backward compat for segments without highlights array).
 */
export async function highlightRange(
	filePath: string,
	startLine: number,
	endLine: number,
): Promise<void> {
	const zeroStart = Math.max(0, startLine - 1);
	const zeroEnd = Math.max(zeroStart, endLine - 1);

	const uri = vscode.Uri.file(filePath);
	const doc = await vscode.workspace.openTextDocument(uri);
	const editor = await vscode.window.showTextDocument(doc, {
		preview: false,
		preserveFocus: false,
	});

	const startPos = new vscode.Position(zeroStart, 0);
	const endPos = new vscode.Position(zeroEnd, doc.lineAt(zeroEnd).text.length);
	const range = new vscode.Range(startPos, endPos);

	editor.selection = new vscode.Selection(startPos, startPos);
	editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
	// For legacy mode, dim the range and add active border
	editor.setDecorations(dimDecoration, []);
	editor.setDecorations(activeDecoration, [range]);
}

// ── Smooth scrolling management ──

let originalSmoothScrolling: boolean | undefined;

export async function enableSmoothScrolling(): Promise<void> {
	const config = vscode.workspace.getConfiguration("editor");
	originalSmoothScrolling = config.get<boolean>("smoothScrolling");
	if (!originalSmoothScrolling) {
		await config.update("smoothScrolling", true, vscode.ConfigurationTarget.Global);
	}
}

export async function restoreSmoothScrolling(): Promise<void> {
	if (originalSmoothScrolling === undefined) return;
	const config = vscode.workspace.getConfiguration("editor");
	await config.update("smoothScrolling", originalSmoothScrolling, vscode.ConfigurationTarget.Global);
	originalSmoothScrolling = undefined;
}

export function clearHighlights(): void {
	for (const editor of vscode.window.visibleTextEditors) {
		editor.setDecorations(dimDecoration, []);
		editor.setDecorations(segmentDimDecoration, []);
		editor.setDecorations(activeDecoration, []);
		editor.setDecorations(gapDecoration, []);
	}
}

export function disposeHighlights(): void {
	dimDecoration.dispose();
	segmentDimDecoration.dispose();
	activeDecoration.dispose();
	gapDecoration.dispose();
}
