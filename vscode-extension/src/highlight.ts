import * as vscode from "vscode";

// Dim background for the full segment range
const segmentDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: "rgba(130, 170, 255, 0.06)",
	isWholeLine: true,
	overviewRulerColor: "rgba(130, 170, 255, 0.35)",
	overviewRulerLane: vscode.OverviewRulerLane.Center,
});

// Bright highlight for the active sub-highlight
const activeDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: "rgba(97, 218, 251, 0.15)",
	isWholeLine: true,
	borderWidth: "0 0 0 3px",
	borderStyle: "solid",
	borderColor: "rgba(97, 218, 251, 0.7)",
	overviewRulerColor: "rgba(97, 218, 251, 0.6)",
	overviewRulerLane: vscode.OverviewRulerLane.Center,
});

/**
 * Open a file and apply the dim segment background.
 * Returns the editor for subsequent sub-highlight calls.
 */
export async function highlightSegmentRange(
	filePath: string,
	startLine: number,
	endLine: number,
): Promise<vscode.TextEditor> {
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

	editor.setDecorations(segmentDecoration, [range]);
	// Clear any previous active highlight
	editor.setDecorations(activeDecoration, []);
	// Reveal full range initially
	editor.selection = new vscode.Selection(startPos, startPos);
	editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

	return editor;
}

/**
 * Apply the bright active highlight to a sub-range and scroll to it.
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

	const startPos = new vscode.Position(zeroStart, 0);
	const endPos = new vscode.Position(zeroEnd, doc.lineAt(zeroEnd).text.length);
	const range = new vscode.Range(startPos, endPos);

	editor.setDecorations(activeDecoration, [range]);
	editor.selection = new vscode.Selection(startPos, startPos);
	editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
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
	editor.setDecorations(segmentDecoration, [range]);
	editor.setDecorations(activeDecoration, []);
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
