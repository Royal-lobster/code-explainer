import * as http from "http";
import * as crypto from "crypto";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { WebSocketServer, WebSocket } from "ws";
import type { Walkthrough } from "./walkthrough";
import type { AgentMessage, ExtensionMessage, UserActionMessage } from "./types";

const PORT_FILE = path.join(os.homedir(), ".claude-explainer-port");
const TOKEN_FILE = path.join(os.homedir(), ".claude-explainer-token");
const MAX_BODY_SIZE = 1024 * 1024; // 1MB
const MAX_LONG_POLL_TIMEOUT = 120_000; // 2 minutes

const VALID_AGENT_MESSAGE_TYPES = new Set([
	"set_plan",
	"insert_after",
	"replace_segment",
	"remove_segments",
	"goto",
	"resume",
	"stop",
]);

export class ExplainerServer {
	private httpServer: http.Server;
	private wss: WebSocketServer;
	private walkthrough: Walkthrough;
	private wsClients: Set<WebSocket> = new Set();
	private pendingActions: UserActionMessage[] = [];
	private actionWaiters: Array<(action: UserActionMessage) => void> = [];
	private port = 0;
	private authToken: string;

	constructor(walkthrough: Walkthrough) {
		this.walkthrough = walkthrough;
		this.authToken = crypto.randomBytes(32).toString("hex");
		this.httpServer = http.createServer(this.handleHttp.bind(this));
		this.wss = new WebSocketServer({
			server: this.httpServer,
			verifyClient: (info: { req: http.IncomingMessage }) => this.checkAuth(info.req),
		});
		this.wss.on("connection", this.handleWs.bind(this));
	}

	async start(): Promise<number> {
		return new Promise((resolve) => {
			this.httpServer.listen(0, "127.0.0.1", () => {
				const addr = this.httpServer.address();
				this.port = typeof addr === "object" && addr ? addr.port : 0;
				fs.writeFileSync(PORT_FILE, String(this.port), "utf-8");
				fs.writeFileSync(TOKEN_FILE, this.authToken, { encoding: "utf-8", mode: 0o600 });
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
		try {
			fs.unlinkSync(TOKEN_FILE);
		} catch {}
	}

	/** Queue a user action for the agent to pick up via long-poll or WS */
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

	// ── Auth ──

	private checkAuth(req: http.IncomingMessage): boolean {
		const auth = req.headers["authorization"];
		if (auth === `Bearer ${this.authToken}`) return true;
		const token = req.headers["x-auth-token"];
		if (token === this.authToken) return true;
		return false;
	}

	// ── HTTP handler ──

	private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
		res.setHeader("Content-Type", "application/json");

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		if (!this.checkAuth(req)) {
			res.writeHead(401);
			res.end(JSON.stringify({ error: "Unauthorized" }));
			return;
		}

		const url = new URL(req.url || "/", `http://127.0.0.1:${this.port}`);

		if (req.method === "GET" && url.pathname === "/api/health") {
			res.writeHead(200);
			res.end(JSON.stringify({ status: "ok" }));
		} else if (req.method === "GET" && url.pathname === "/api/state") {
			this.handleGetState(res);
		} else if (req.method === "GET" && url.pathname === "/api/actions") {
			const rawTimeout = parseInt(url.searchParams.get("timeout") || "30", 10) * 1000;
			const timeout = Math.min(Math.max(rawTimeout, 1000), MAX_LONG_POLL_TIMEOUT);
			this.handleGetActions(res, timeout);
		} else if (req.method === "POST" && url.pathname === "/api/message") {
			this.readBody(req, res, (body) => {
				try {
					const msg = JSON.parse(body);
					if (!this.validateAgentMessage(msg)) {
						res.writeHead(400);
						res.end(JSON.stringify({ error: "Invalid message format" }));
						return;
					}
					this.handleAgentMessage(msg as AgentMessage);
					res.writeHead(200);
					res.end(JSON.stringify({ ok: true }));
				} catch {
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
				const msg = JSON.parse(data.toString());
				if (!this.validateAgentMessage(msg)) {
					console.error("[code-explainer] Invalid WS message format");
					return;
				}
				this.handleAgentMessage(msg as AgentMessage);
			} catch (err) {
				console.error("[code-explainer] Invalid WS message:", err);
			}
		});

		ws.on("close", () => {
			this.wsClients.delete(ws);
		});

		// Send current state on connect
		this.broadcastState();
	}

	// ── Validation ──

	private validateAgentMessage(msg: unknown): boolean {
		if (!msg || typeof msg !== "object") return false;
		const m = msg as Record<string, unknown>;
		if (typeof m.type !== "string" || !VALID_AGENT_MESSAGE_TYPES.has(m.type)) return false;

		switch (m.type) {
			case "set_plan":
				return typeof m.title === "string" && Array.isArray(m.segments);
			case "insert_after":
				return typeof m.afterSegment === "number" && Array.isArray(m.segments);
			case "replace_segment":
				return typeof m.id === "number" && typeof m.segment === "object" && m.segment !== null;
			case "remove_segments":
				return Array.isArray(m.ids);
			case "goto":
				return typeof m.segmentId === "number";
			case "resume":
			case "stop":
				return true;
			default:
				return false;
		}
	}

	// ── Message dispatch ──

	private onAgentMessage?: (msg: AgentMessage) => void;

	setMessageHandler(handler: (msg: AgentMessage) => void): void {
		this.onAgentMessage = handler;
	}

	private handleAgentMessage(msg: AgentMessage): void {
		this.onAgentMessage?.(msg);
	}

	// ── Helpers ──

	private readBody(req: http.IncomingMessage, res: http.ServerResponse, cb: (body: string) => void): void {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
			if (body.length > MAX_BODY_SIZE) {
				res.writeHead(413);
				res.end(JSON.stringify({ error: "Request body too large" }));
				req.destroy();
			}
		});
		req.on("end", () => {
			if (!res.writableEnded) cb(body);
		});
	}
}
