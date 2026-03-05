# Sharing Walkthroughs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable saving walkthroughs as `.walkthrough.json` files in the repo and loading them back for replay.

**Architecture:** Add a `WalkthroughStorage` module that handles path conversion (absolute↔relative) and file I/O. Wire it into the existing server (new endpoints), extension (new commands), sidebar (save button + browse list), and CLI (new shell commands).

**Tech Stack:** TypeScript (VS Code Extension API), Node.js `fs`, existing HTTP server, existing sidebar webview.

---

### Task 1: Add WalkthroughStorage module

**Files:**
- Create: `vscode-extension/src/storage.ts`

**Step 1: Create the storage module**

```typescript
import * as fs from "fs";
import * as path from "path";
import type { Segment } from "./types";

export interface WalkthroughFile {
	title: string;
	segments: Segment[];
}

export class WalkthroughStorage {
	private dir: string;

	constructor(private workspaceRoot: string) {
		this.dir = path.join(workspaceRoot, ".walkthroughs");
	}

	/** Ensure .walkthroughs/ directory exists */
	private ensureDir(): void {
		if (!fs.existsSync(this.dir)) {
			fs.mkdirSync(this.dir, { recursive: true });
		}
	}

	/** Convert title to filename slug */
	static slugify(title: string): string {
		return title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			|| "walkthrough";
	}

	/** Convert absolute file paths to relative */
	private toRelativePaths(segments: Segment[]): Segment[] {
		return segments.map((seg) => ({
			...seg,
			file: path.relative(this.workspaceRoot, seg.file),
		}));
	}

	/** Convert relative file paths to absolute */
	private toAbsolutePaths(segments: Segment[]): Segment[] {
		return segments.map((seg) => ({
			...seg,
			file: path.isAbsolute(seg.file)
				? seg.file
				: path.join(this.workspaceRoot, seg.file),
		}));
	}

	/** Save current walkthrough to disk. Returns the file path. */
	save(title: string, segments: Segment[], name?: string): string {
		this.ensureDir();
		const slug = name ? WalkthroughStorage.slugify(name) : WalkthroughStorage.slugify(title);
		const filePath = path.join(this.dir, `${slug}.json`);
		const data: WalkthroughFile = {
			title,
			segments: this.toRelativePaths(segments),
		};
		fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
		return filePath;
	}

	/** Check if a walkthrough file already exists for a given name/title */
	exists(titleOrName: string): boolean {
		const slug = WalkthroughStorage.slugify(titleOrName);
		return fs.existsSync(path.join(this.dir, `${slug}.json`));
	}

	/** Load a walkthrough from disk by slug name. Returns null if not found. */
	load(name: string): { title: string; segments: Segment[] } | null {
		const slug = WalkthroughStorage.slugify(name);
		const filePath = path.join(this.dir, `${slug}.json`);
		if (!fs.existsSync(filePath)) return null;
		const raw = fs.readFileSync(filePath, "utf-8");
		const data: WalkthroughFile = JSON.parse(raw);
		return {
			title: data.title,
			segments: this.toAbsolutePaths(data.segments),
		};
	}

	/** List all saved walkthrough files. Returns array of {name, title, filePath}. */
	list(): Array<{ name: string; title: string; filePath: string }> {
		if (!fs.existsSync(this.dir)) return [];
		const files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".json"));
		const results: Array<{ name: string; title: string; filePath: string }> = [];
		for (const file of files) {
			const filePath = path.join(this.dir, file);
			try {
				const raw = fs.readFileSync(filePath, "utf-8");
				const data: WalkthroughFile = JSON.parse(raw);
				results.push({
					name: file.replace(/\.json$/, ""),
					title: data.title,
					filePath,
				});
			} catch {
				// Skip malformed files
			}
		}
		return results;
	}
}
```

**Step 2: Verify it compiles**

Run: `cd vscode-extension && npx tsc --noEmit`
Expected: No errors related to storage.ts

**Step 3: Commit**

```bash
git add vscode-extension/src/storage.ts
git commit -m "feat: add WalkthroughStorage module for save/load"
```

---

### Task 2: Add server endpoints for save/load/list

**Files:**
- Modify: `vscode-extension/src/server.ts` (add `/api/save`, `/api/walkthroughs`, `/api/load` routes)

**Step 1: Add WalkthroughStorage to server constructor**

In `server.ts`, import `WalkthroughStorage` and accept it as a constructor parameter:

```typescript
import type { WalkthroughStorage } from "./storage";
```

Add to constructor: `private storage: WalkthroughStorage | undefined`

Add setter: `setStorage(storage: WalkthroughStorage): void { this.storage = storage; }`

**Step 2: Add save endpoint**

In `handleHttp`, add before the 404 fallback:

```typescript
} else if (req.method === "POST" && url.pathname === "/api/save") {
	this.readBody(req, res, (body) => {
		try {
			const { name } = JSON.parse(body);
			this.handleSave(res, name);
		} catch {
			this.handleSave(res);
		}
	});
} else if (req.method === "GET" && url.pathname === "/api/walkthroughs") {
	this.handleListWalkthroughs(res);
} else if (req.method === "POST" && url.pathname === "/api/load") {
	this.readBody(req, res, (body) => {
		try {
			const { name } = JSON.parse(body);
			this.handleLoad(res, name);
		} catch {
			res.writeHead(400);
			res.end(JSON.stringify({ error: "Invalid JSON" }));
		}
	});
}
```

**Step 3: Implement handler methods**

```typescript
private handleSave(res: http.ServerResponse, name?: string): void {
	if (!this.storage) {
		res.writeHead(500);
		res.end(JSON.stringify({ error: "No workspace folder open" }));
		return;
	}
	const state = this.walkthrough.getState();
	if (state.segments.length === 0) {
		res.writeHead(400);
		res.end(JSON.stringify({ error: "No active walkthrough to save" }));
		return;
	}
	const filePath = this.storage.save(state.title, state.segments, name);
	res.writeHead(200);
	res.end(JSON.stringify({ ok: true, filePath }));
}

private handleListWalkthroughs(res: http.ServerResponse): void {
	if (!this.storage) {
		res.writeHead(200);
		res.end(JSON.stringify({ walkthroughs: [] }));
		return;
	}
	const walkthroughs = this.storage.list();
	res.writeHead(200);
	res.end(JSON.stringify({ walkthroughs }));
}

private handleLoad(res: http.ServerResponse, name: string): void {
	if (!this.storage) {
		res.writeHead(500);
		res.end(JSON.stringify({ error: "No workspace folder open" }));
		return;
	}
	const data = this.storage.load(name);
	if (!data) {
		res.writeHead(404);
		res.end(JSON.stringify({ error: `Walkthrough "${name}" not found` }));
		return;
	}
	this.walkthrough.setPlan(data.title, data.segments);
	res.writeHead(200);
	res.end(JSON.stringify({ ok: true, title: data.title, segments: data.segments.length }));
}
```

**Step 4: Verify it compiles**

Run: `cd vscode-extension && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add vscode-extension/src/server.ts
git commit -m "feat: add save/load/list API endpoints"
```

---

### Task 3: Wire storage into extension activation and add commands

**Files:**
- Modify: `vscode-extension/src/extension.ts` (create storage, set on server, register save/load commands)
- Modify: `vscode-extension/package.json` (register new commands)

**Step 1: Add storage to extension.ts**

After `const server = new ExplainerServer(walkthrough);`, add:

```typescript
import { WalkthroughStorage } from "./storage";

// ... inside activate():
let storage: WalkthroughStorage | undefined;
if (wsFolder) {
	storage = new WalkthroughStorage(wsFolder);
	server.setStorage(storage);
}
```

**Step 2: Register save command**

Add to the `context.subscriptions.push(...)` block:

```typescript
vscode.commands.registerCommand('codeExplainer.saveWalkthrough', async () => {
	if (!storage) {
		vscode.window.showErrorMessage("No workspace folder open");
		return;
	}
	const state = walkthrough.getState();
	if (state.segments.length === 0) {
		vscode.window.showWarningMessage("No active walkthrough to save");
		return;
	}
	const defaultName = WalkthroughStorage.slugify(state.title);
	const name = await vscode.window.showInputBox({
		prompt: "Walkthrough name",
		value: defaultName,
		validateInput: (v) => v.trim() ? null : "Name cannot be empty",
	});
	if (!name) return; // cancelled
	if (storage.exists(name)) {
		const overwrite = await vscode.window.showWarningMessage(
			`"${name}" already exists. Overwrite?`,
			"Overwrite", "Cancel"
		);
		if (overwrite !== "Overwrite") return;
	}
	const filePath = storage.save(state.title, state.segments, name);
	vscode.window.showInformationMessage(`Walkthrough saved to ${path.relative(wsFolder!, filePath)}`);
}),
```

**Step 3: Register load command**

```typescript
vscode.commands.registerCommand('codeExplainer.loadWalkthrough', async () => {
	if (!storage) {
		vscode.window.showErrorMessage("No workspace folder open");
		return;
	}
	const items = storage.list();
	if (items.length === 0) {
		vscode.window.showInformationMessage("No saved walkthroughs found in .walkthroughs/");
		return;
	}
	const pick = await vscode.window.showQuickPick(
		items.map((item) => ({
			label: item.title,
			description: item.name,
			name: item.name,
		})),
		{ placeHolder: "Select a walkthrough to load" }
	);
	if (!pick) return; // cancelled
	const data = storage.load(pick.name);
	if (!data) {
		vscode.window.showErrorMessage("Failed to load walkthrough");
		return;
	}
	walkthrough.setPlan(data.title, data.segments);
	sidebar.reveal();
}),
```

**Step 4: Register commands in package.json**

Add to `contributes.commands` array:

```json
{ "command": "codeExplainer.saveWalkthrough", "title": "Code Explainer: Save Walkthrough" },
{ "command": "codeExplainer.loadWalkthrough", "title": "Code Explainer: Load Walkthrough" }
```

**Step 5: Verify it compiles**

Run: `cd vscode-extension && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add vscode-extension/src/extension.ts vscode-extension/package.json
git commit -m "feat: add save/load walkthrough commands"
```

---

### Task 4: Add save button and browse list to sidebar

**Files:**
- Modify: `vscode-extension/src/sidebar.ts` (add save/load/list message types, update HTML)
- Modify: `vscode-extension/media/sidebar.js` (handle save button click, render browse list)
- Modify: `vscode-extension/media/sidebar.css` (style save button and browse list)
- Modify: `vscode-extension/src/types.ts` (add new webview message types)

**Step 1: Add new message types to types.ts**

Add to `FromWebviewMessage` union:

```typescript
export interface WebviewSaveMessage {
	type: "save";
}

export interface WebviewLoadMessage {
	type: "load";
	name: string;
}

export interface WebviewRequestSavedListMessage {
	type: "request_saved_list";
}
```

Add these to the `FromWebviewMessage` union type.

Add to `ToWebviewMessage` union:

```typescript
export interface WebviewSavedListMessage {
	type: "saved_list";
	walkthroughs: Array<{ name: string; title: string }>;
}
```

Add to the `ToWebviewMessage` union type.

**Step 2: Add save button to sidebar HTML**

In `sidebar.ts` `getHtml()`, add a save button in the header div (after the h2):

```html
<div class="header">
	<h2 id="walkthrough-title"></h2>
	<button id="btn-save" class="save-btn" title="Save Walkthrough">
		<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
			<path d="M13.354 4.354l-3.708-3.708A.5.5 0 009.293.5H2.5A1.5 1.5 0 001 2v12a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0015 14V4.707a.5.5 0 00-.146-.353zM12 14H4V9h8v5zm1-7H3V2h6.293L13 5.707V7z"/>
		</svg>
	</button>
</div>
```

Add browse list to idle-view:

```html
<div id="idle-view">
	<p class="idle-text">Waiting for walkthrough...</p>
	<p class="idle-hint">Run <code>/explainer</code> in your coding agent to start</p>
	<div id="saved-list-section" style="display:none;">
		<h3 class="saved-list-title">Saved Walkthroughs</h3>
		<ul id="saved-list"></ul>
	</div>
</div>
```

**Step 3: Add sidebar.js handlers**

Add save button click handler:

```javascript
document.getElementById("btn-save").addEventListener("click", () => {
	vscode.postMessage({ type: "save" });
});
```

Add request for saved list when idle:

```javascript
// In the render() function, after setting idle-view visible:
if (state.status === "idle" || state.status === "stopped") {
	vscode.postMessage({ type: "request_saved_list" });
}
```

Add handler for `saved_list` message:

```javascript
case "saved_list": {
	const section = document.getElementById("saved-list-section");
	const list = document.getElementById("saved-list");
	if (msg.walkthroughs.length === 0) {
		section.style.display = "none";
		break;
	}
	section.style.display = "";
	list.innerHTML = "";
	for (const wt of msg.walkthroughs) {
		const li = document.createElement("li");
		li.className = "saved-item";
		li.textContent = wt.title;
		li.addEventListener("click", () => {
			vscode.postMessage({ type: "load", name: wt.name });
		});
		list.appendChild(li);
	}
	break;
}
```

**Step 4: Add CSS for save button and browse list**

```css
/* ── Save button ── */

.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.save-btn {
	background: none;
	border: none;
	color: var(--vscode-foreground);
	cursor: pointer;
	opacity: 0.6;
	padding: 4px;
	border-radius: 4px;
	transition: opacity 0.15s ease, background 0.15s ease;
}

.save-btn:hover {
	opacity: 1;
	background: var(--vscode-toolbar-hoverBackground);
}

/* ── Saved walkthroughs list ── */

.saved-list-title {
	font-size: 0.9em;
	font-weight: 600;
	margin: 24px 0 8px;
	opacity: 0.8;
}

#saved-list {
	list-style: none;
}

.saved-item {
	padding: 8px 12px;
	border-radius: 6px;
	cursor: pointer;
	font-size: 0.9em;
	transition: background 0.15s ease;
}

.saved-item:hover {
	background: var(--vscode-list-hoverBackground);
}
```

**Step 5: Wire message handlers in extension.ts**

In the `sidebar.setMessageHandler` switch, add cases:

```typescript
case "save":
	vscode.commands.executeCommand('codeExplainer.saveWalkthrough');
	break;
case "load":
	if (storage) {
		const data = storage.load(msg.name);
		if (data) {
			walkthrough.setPlan(data.title, data.segments);
			sidebar.reveal();
		}
	}
	break;
case "request_saved_list":
	if (storage) {
		sidebar.postMessage({
			type: "saved_list",
			walkthroughs: storage.list().map(({ name, title }) => ({ name, title })),
		});
	}
	break;
```

**Step 6: Verify it compiles**

Run: `cd vscode-extension && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add vscode-extension/src/types.ts vscode-extension/src/sidebar.ts vscode-extension/src/extension.ts vscode-extension/media/sidebar.js vscode-extension/media/sidebar.css
git commit -m "feat: add save button and browse list to sidebar"
```

---

### Task 5: Add CLI commands to explainer.sh

**Files:**
- Modify: `scripts/explainer.sh`

**Step 1: Add save, load, list commands**

Add to the `case` statement in explainer.sh:

```bash
save)
    NAME="${2:-}"
    if [ -n "$NAME" ]; then
        curl -s -X POST "$BASE/api/save" \
            -H 'Content-Type: application/json' \
            -H "$AUTH_HEADER" \
            -d "{\"name\": \"$NAME\"}"
    else
        curl -s -X POST "$BASE/api/save" \
            -H 'Content-Type: application/json' \
            -H "$AUTH_HEADER" \
            -d '{}'
    fi
    ;;
load)
    if [ -z "$2" ]; then
        echo "Usage: explainer.sh load <name>" >&2
        exit 1
    fi
    curl -s -X POST "$BASE/api/load" \
        -H 'Content-Type: application/json' \
        -H "$AUTH_HEADER" \
        -d "{\"name\": \"$2\"}"
    ;;
list)
    curl -s -H "$AUTH_HEADER" "$BASE/api/walkthroughs"
    ;;
```

Update the usage line:

```bash
echo "Usage: explainer.sh {plan|send|state|wait-action|stop|save|load|list}" >&2
```

**Step 2: Commit**

```bash
git add scripts/explainer.sh
git commit -m "feat: add save/load/list CLI commands"
```

---

### Task 6: Build, install, and manual test

**Files:**
- No new files

**Step 1: Build the extension**

Run: `cd vscode-extension && npm run compile`
Expected: Build succeeds with no errors

**Step 2: Package and install**

Run: `cd vscode-extension && npm run package`
Then install the `.vsix` file in VS Code.

**Step 3: Manual test — save flow**

1. Run a walkthrough via agent (or send a test plan via `explainer.sh plan`)
2. Open command palette → "Code Explainer: Save Walkthrough"
3. Verify: Input box shows with slugified title
4. Verify: File appears in `.walkthroughs/` with relative paths
5. Verify: Notification shown

**Step 4: Manual test — load flow**

1. Open command palette → "Code Explainer: Load Walkthrough"
2. Verify: QuickPick shows saved walkthrough
3. Select it → Verify: Walkthrough loads and sidebar shows it
4. Verify: Paths resolved correctly (highlighting works)

**Step 5: Manual test — sidebar browse**

1. Stop the walkthrough (idle state)
2. Verify: Sidebar shows "Saved Walkthroughs" section
3. Click a walkthrough → Verify: It loads

**Step 6: Manual test — CLI**

1. Run: `./scripts/explainer.sh list` → Verify: Shows saved walkthroughs
2. Run: `./scripts/explainer.sh save test-name` → Verify: Saves current plan
3. Run: `./scripts/explainer.sh load test-name` → Verify: Loads the plan

**Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```
