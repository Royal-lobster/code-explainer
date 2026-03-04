import * as vscode from "vscode";

// Non-active segment lines: dimmed out
const segmentDecoration = vscode.window.createTextEditorDecorationType({
	opacity: "0.35",
	isWholeLine: true,
	overviewRulerColor: "rgba(255, 255, 255, 0.15)",
	overviewRulerLane: vscode.OverviewRulerLane.Center,
});

// Active sub-highlight: full opacity with left border accent
const activeDecoration = vscode.window.createTextEditorDecorationType({
	isWholeLine: true,
	borderWidth: "0 0 0 3px",
	borderStyle: "solid",
	borderColor: "rgba(255, 190, 60, 0.8)",
	overviewRulerColor: "rgba(255, 190, 60, 0.5)",
	overviewRulerLane: vscode.OverviewRulerLane.Center,
});

// Track current segment range for computing dim regions
let currentSegmentStart = 0;
let currentSegmentEnd = 0;

/**
 * Build ranges for all lines in [segStart, segEnd] EXCLUDING [activeStart, activeEnd].
 * All values are 0-based line numbers.
 */
function buildDimRanges(
	doc: vscode.TextDocument,
	segStart: number,
	segEnd: number,
	activeStart?: number,
	activeEnd?: number,
): vscode.Range[] {
	const ranges: vscode.Range[] = [];

	if (activeStart === undefined || activeEnd === undefined) {
		// Dim the entire segment
		for (let i = segStart; i <= segEnd; i++) {
			const line = doc.lineAt(i);
			ranges.push(new vscode.Range(line.range.start, line.range.end));
		}
		return ranges;
	}

	// Dim lines before the active range
	for (let i = segStart; i < activeStart; i++) {
		const line = doc.lineAt(i);
		ranges.push(new vscode.Range(line.range.start, line.range.end));
	}
	// Dim lines after the active range
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

	// Dim all segment lines
	const dimRanges = buildDimRanges(doc, zeroStart, zeroEnd);
	editor.setDecorations(segmentDecoration, dimRanges);
	// Clear any previous active highlight
	editor.setDecorations(activeDecoration, []);

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
): Promise<void> {
	const zeroStart = Math.max(0, startLine - 1);
	const zeroEnd = Math.max(zeroStart, endLine - 1);

	const uri = vscode.Uri.file(filePath);
	const doc = await vscode.workspace.openTextDocument(uri);
	const editor = await vscode.window.showTextDocument(doc, {
		preview: false,
		preserveFocus: false,
	});

	// Re-compute dim ranges excluding the active sub-range
	const dimRanges = buildDimRanges(doc, currentSegmentStart, currentSegmentEnd, zeroStart, zeroEnd);
	editor.setDecorations(segmentDecoration, dimRanges);

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
	editor.setDecorations(segmentDecoration, []);
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
		editor.setDecorations(segmentDecoration, []);
		editor.setDecorations(activeDecoration, []);
	}
}

export function disposeHighlights(): void {
	segmentDecoration.dispose();
	activeDecoration.dispose();
}
