import * as http from "http";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { WebSocketServer, WebSocket } from "ws";
import type { Walkthrough } from "./walkthrough";
import type { ClaudeMessage, ExtensionMessage, UserActionMessage } from "./types";

const PORT_FILE = path.join(os.homedir(), ".claude-explainer-port");

export class ExplainerServer {
	private httpServer: http.Server;
	private wss: WebSocketServer;
	private walkthrough: Walkthrough;
	private wsClients: Set<WebSocket> = new Set();
	private pendingActions: UserActionMessage[] = [];
	private actionWaiters: Array<(action: UserActionMessage) => void> = [];
	private port = 0;

	constructor(walkthrough: Walkthrough) {
		this.walkthrough = walkthrough;
		this.httpServer = http.createServer(this.handleHttp.bind(this));
		this.wss = new WebSocketServer({ server: this.httpServer });
		this.wss.on("connection", this.handleWs.bind(this));
	}

	async start(): Promise<number> {
		return new Promise((resolve) => {
			this.httpServer.listen(0, "127.0.0.1", () => {
				const addr = this.httpServer.address();
				this.port = typeof addr === "object" && addr ? addr.port : 0;
				fs.writeFileSync(PORT_FILE, String(this.port), "utf-8");
				resolve(this.port);
			});
		});
	}

	stop(): void {
		for (const ws of this.wsClients) ws.close();
		this.wss.close();
		this.httpServer.close();
		try {
			fs.unlinkSync(PORT_FILE);
		} catch {}
	}

	/** Queue a user action for Claude to pick up via long-poll or WS */
	queueAction(action: UserActionMessage): void {
		// If someone is waiting, deliver immediately
		const waiter = this.actionWaiters.shift();
		if (waiter) {
			waiter(action);
		} else {
			this.pendingActions.push(action);
		}
		// Also broadcast to WS clients
		this.broadcastToClients(action);
	}

	/** Send state to all connected WS clients */
	broadcastState(): void {
		const state = this.walkthrough.getState();
		const msg: ExtensionMessage = {
			type: "state",
			currentSegment: state.segments[state.currentIndex]?.id ?? -1,
			status: state.status,
			totalSegments: state.segments.length,
		};
		this.broadcastToClients(msg);
	}

	private broadcastToClients(msg: ExtensionMessage | UserActionMessage): void {
		const json = JSON.stringify(msg);
		for (const ws of this.wsClients) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(json);
			}
		}
	}

	// ── HTTP handler ──

	private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
		res.setHeader("Content-Type", "application/json");
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		const url = new URL(req.url || "/", `http://127.0.0.1:${this.port}`);

		if (req.method === "GET" && url.pathname === "/api/state") {
			this.handleGetState(res);
		} else if (req.method === "GET" && url.pathname === "/api/actions") {
			const timeout = parseInt(url.searchParams.get("timeout") || "30", 10) * 1000;
			this.handleGetActions(res, timeout);
		} else if (req.method === "POST") {
			this.readBody(req, (body) => {
				try {
					const msg = JSON.parse(body) as ClaudeMessage;
					this.handleClaudeMessage(msg);
					res.writeHead(200);
					res.end(JSON.stringify({ ok: true }));
				} catch (err) {
					res.writeHead(400);
					res.end(JSON.stringify({ error: "Invalid JSON" }));
				}
			});
		} else {
			res.writeHead(404);
			res.end(JSON.stringify({ error: "Not found" }));
		}
	}

	private handleGetState(res: http.ServerResponse): void {
		const state = this.walkthrough.getState();
		res.writeHead(200);
		res.end(
			JSON.stringify({
				title: state.title,
				currentSegment: state.segments[state.currentIndex]?.id ?? -1,
				status: state.status,
				totalSegments: state.segments.length,
				currentIndex: state.currentIndex,
			}),
		);
	}

	private handleGetActions(res: http.ServerResponse, timeout: number): void {
		// Return pending action immediately if available
		const action = this.pendingActions.shift();
		if (action) {
			res.writeHead(200);
			res.end(JSON.stringify(action));
			return;
		}

		// Long-poll: wait for next action
		const timer = setTimeout(() => {
			const idx = this.actionWaiters.indexOf(waiter);
			if (idx !== -1) this.actionWaiters.splice(idx, 1);
			res.writeHead(204);
			res.end();
		}, timeout);

		const waiter = (action: UserActionMessage) => {
			clearTimeout(timer);
			res.writeHead(200);
			res.end(JSON.stringify(action));
		};

		this.actionWaiters.push(waiter);

		res.on("close", () => {
			clearTimeout(timer);
			const idx = this.actionWaiters.indexOf(waiter);
			if (idx !== -1) this.actionWaiters.splice(idx, 1);
		});
	}

	// ── WebSocket handler ──

	private handleWs(ws: WebSocket): void {
		this.wsClients.add(ws);

		ws.on("message", (data) => {
			try {
				const msg = JSON.parse(data.toString()) as ClaudeMessage;
				this.handleClaudeMessage(msg);
			} catch {}
		});

		ws.on("close", () => {
			this.wsClients.delete(ws);
		});

		// Send current state on connect
		this.broadcastState();
	}

	// ── Message dispatch ──

	private onClaudeMessage?: (msg: ClaudeMessage) => void;

	setMessageHandler(handler: (msg: ClaudeMessage) => void): void {
		this.onClaudeMessage = handler;
	}

	private handleClaudeMessage(msg: ClaudeMessage): void {
		this.onClaudeMessage?.(msg);
	}

	// ── Helpers ──

	private readBody(req: http.IncomingMessage, cb: (body: string) => void): void {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => cb(body));
	}
}
