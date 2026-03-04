import * as vscode from "vscode";

const highlightDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: "rgba(255, 213, 79, 0.18)",
	isWholeLine: true,
	overviewRulerColor: "rgba(255, 213, 79, 0.6)",
	overviewRulerLane: vscode.OverviewRulerLane.Center,
});

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
	editor.setDecorations(highlightDecoration, [range]);
}

export function clearHighlights(): void {
	for (const editor of vscode.window.visibleTextEditors) {
		editor.setDecorations(highlightDecoration, []);
	}
}

export function disposeHighlights(): void {
	highlightDecoration.dispose();
}
