import * as net from "net";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as cp from "child_process";
import { Endpoint, readEndpoint, removeEndpoint } from "./tts/endpoint";
import { systemPython, venvPython } from "./tts/paths";

const SAMPLE_RATE = 24000;
const SERVER_START_TIMEOUT_MS = 120_000;
const PING_TIMEOUT_MS = 2000;

export interface TTSOptions {
	voice: string;
	speed: number;
}

/**
 * Verify a server is alive at `ep` and accepts our token.
 * @param ep - Endpoint read from the endpoint file.
 * @returns Resolves true only if the server answered.
 */
function pingServer(ep: Endpoint): Promise<boolean> {
	return new Promise((resolve) => {
		const conn = net.createConnection({ host: ep.host, port: ep.port });
		const finish = (alive: boolean) => {
			clearTimeout(timeout);
			conn.destroy();
			resolve(alive);
		};
		const timeout = setTimeout(() => finish(false), PING_TIMEOUT_MS);
		conn.on("connect", () => conn.end(JSON.stringify({ token: ep.token, ping: true }), "utf-8"));
		conn.on("data", () => finish(true));
		conn.on("error", () => finish(false));
		conn.on("close", () => finish(false));
	});
}

/**
 * Return the running server's endpoint, cleaning up a stale file if found.
 * @returns The live endpoint, or undefined.
 */
async function liveEndpoint(): Promise<Endpoint | undefined> {
	const ep = readEndpoint();
	if (!ep) return undefined;
	if (await pingServer(ep)) return ep;
	console.log("[tts-bridge] Stale endpoint detected, cleaning up...");
	removeEndpoint(ep.pid);
	return undefined;
}

let workspaceRoot: string | undefined;

/**
 * Set the workspace root so we can find the TTS server script and venv Python.
 * Call this from extension.ts during activation.
 * @param root - Workspace folder path.
 */
export function setWorkspaceRoot(root: string): void {
	workspaceRoot = root;
}

/**
 * Known locations of the code-explainer project root.
 * @returns Candidate directories, most specific first.
 */
function getProjectRootCandidates(): string[] {
	const candidates: string[] = [];
	if (workspaceRoot) candidates.push(workspaceRoot);
	candidates.push(path.join(os.homedir(), ".claude", "skills", "explainer"));
	return candidates;
}

/**
 * Resolve the path to the TTS server script.
 * @returns The script path, or undefined if TTS is not installed.
 */
function getServerScript(): string | undefined {
	for (const root of getProjectRootCandidates()) {
		const p = path.join(root, "scripts", "tts_server.py");
		if (fs.existsSync(p)) return p;
	}
	return undefined;
}

/**
 * Find the Python interpreter that has the TTS dependencies.
 * @returns A venv interpreter if one exists, else the OS's python command.
 */
function findPython(): string {
	for (const root of getProjectRootCandidates()) {
		const p = venvPython(root);
		if (fs.existsSync(p)) return path.resolve(p);
	}
	return systemPython();
}

/**
 * Start the TTS server daemon and wait for it to answer.
 * @returns Resolves with the endpoint, or undefined on failure or timeout.
 */
function startServer(): Promise<Endpoint | undefined> {
	return new Promise((resolve) => {
		const serverScript = getServerScript();
		if (!serverScript) {
			console.error("[tts-bridge] Server script not found in workspace:", workspaceRoot);
			resolve(undefined);
			return;
		}

		const pythonBin = findPython();
		console.log(`[tts-bridge] Starting TTS server daemon using ${pythonBin}...`);

		const env = { ...process.env };
		if (workspaceRoot) env.TTS_WORKSPACE_ROOT = workspaceRoot;

		let settled = false;
		const settle = (ep: Endpoint | undefined) => {
			if (settled) return;
			settled = true;
			clearInterval(poll);
			resolve(ep);
		};

		cp.execFile(pythonBin, [serverScript, "--daemon"], { timeout: 10_000, env }, (err, _stdout, stderr) => {
			if (err) {
				console.error("[tts-bridge] Failed to start server daemon:", stderr.trim() || err);
				settle(undefined);
			}
		});

		const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
		let checking = false;
		const poll = setInterval(async () => {
			if (checking) return;
			checking = true;
			try {
				const ep = readEndpoint();
				if (ep && (await pingServer(ep))) {
					settle(ep);
				} else if (Date.now() > deadline) {
					console.error("[tts-bridge] Server did not start in time.");
					settle(undefined);
				}
			} finally {
				checking = false;
			}
		}, 500);
	});
}

let pendingEnsure: Promise<Endpoint | undefined> | undefined;

/**
 * Return a live endpoint, starting the server if needed.
 * Concurrent calls share one startup attempt.
 * @returns The endpoint, or undefined if TTS is unavailable.
 */
async function ensureEndpoint(): Promise<Endpoint | undefined> {
	if (pendingEnsure) return pendingEnsure;
	pendingEnsure = (async () => (await liveEndpoint()) ?? (await startServer()))();
	try {
		return await pendingEnsure;
	} finally {
		pendingEnsure = undefined;
	}
}

/**
 * Ensure the TTS server is running. Starts it if needed.
 * @returns Resolves true if the server is available.
 */
export async function ensureServer(): Promise<boolean> {
	return (await ensureEndpoint()) !== undefined;
}

/**
 * Streams TTS audio from the server, starting it if needed.
 * @param text - Narration.
 * @param options - Voice and speed.
 * @param onChunk - Receives base64 float32 PCM per sentence and the sample rate.
 * @param onEnd - Called when the stream completes.
 * @param onError - Called on failure.
 * @returns A function that aborts the stream.
 */
export function streamTTS(
	text: string,
	options: TTSOptions,
	onChunk: (base64Data: string, sampleRate: number) => void,
	onEnd: () => void,
	onError: (err: Error) => void,
): () => void {
	let aborted = false;
	let conn: net.Socket | undefined;

	const run = async () => {
		const ep = await ensureEndpoint();
		if (!ep) {
			if (!aborted) onError(new Error("TTS server unavailable"));
			return;
		}
		if (aborted) return;
		conn = connectAndStream(ep, text, options, onChunk, onEnd, onError, () => aborted);
	};

	run();

	return () => {
		aborted = true;
		if (conn) conn.destroy();
	};
}

/**
 * Connect to a running server and stream audio frames.
 * @returns The socket, so the caller can abort.
 */
function connectAndStream(
	ep: Endpoint,
	text: string,
	options: TTSOptions,
	onChunk: (base64Data: string, sampleRate: number) => void,
	onEnd: () => void,
	onError: (err: Error) => void,
	isAborted: () => boolean,
): net.Socket {
	let ended = false;

	const conn = net.createConnection({ host: ep.host, port: ep.port });

	conn.on("connect", () => {
		const request = JSON.stringify({
			token: ep.token,
			text,
			voice: options.voice,
			speed: options.speed,
		});
		conn.end(request, "utf-8");
	});

	let buffer = Buffer.alloc(0);
	let waitingForHeader = true;
	let expectedLength = 0;

	conn.on("data", (data: Buffer) => {
		if (isAborted()) return;

		buffer = Buffer.concat([buffer, data]);

		while (buffer.length >= 4) {
			if (waitingForHeader) {
				expectedLength = buffer.readUInt32BE(0);
				buffer = buffer.subarray(4);

				if (expectedLength === 0) {
					ended = true;
					onEnd();
					conn.destroy();
					return;
				}
				waitingForHeader = false;
			}

			if (!waitingForHeader && buffer.length >= expectedLength) {
				const audioBytes = buffer.subarray(0, expectedLength);
				buffer = buffer.subarray(expectedLength);
				waitingForHeader = true;

				onChunk(audioBytes.toString("base64"), SAMPLE_RATE);
			} else {
				break;
			}
		}
	});

	conn.on("error", (err) => {
		if (!isAborted()) onError(err);
	});

	conn.on("close", () => {
		if (!isAborted() && !ended && waitingForHeader && buffer.length === 0) {
			onEnd();
		}
	});

	return conn;
}

/**
 * Quick, non-blocking check whether TTS can be used.
 * @returns True if a server is advertised or the server script is installed (it auto-starts).
 */
export function isTTSAvailable(): boolean {
	return readEndpoint() !== undefined || getServerScript() !== undefined;
}
