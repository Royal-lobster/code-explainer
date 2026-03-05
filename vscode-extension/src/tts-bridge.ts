import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";

const SOCKET_PATH = "/tmp/tts-server.sock";
const PID_FILE = "/tmp/tts-server.pid";
const SAMPLE_RATE = 24000;
const SERVER_START_TIMEOUT_MS = 30_000;
const SERVER_SCRIPT = path.resolve(__dirname, "..", "..", "scripts", "tts_server.py");

export interface TTSOptions {
	voice: string;
	speed: number;
}

/**
 * Check if the TTS server process is alive by verifying the PID file.
 */
function isServerProcessAlive(): boolean {
	try {
		const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
		process.kill(pid, 0); // signal 0 = check alive
		return true;
	} catch {
		return false;
	}
}

/**
 * Remove stale socket and PID files left by a dead server.
 */
function cleanupStaleFiles(): void {
	for (const p of [SOCKET_PATH, PID_FILE]) {
		try {
			fs.unlinkSync(p);
		} catch {}
	}
}

/**
 * Ping the server over the socket to verify it's responsive.
 * Resolves true if alive, false otherwise.
 */
function pingServer(): Promise<boolean> {
	return new Promise((resolve) => {
		const conn = net.createConnection(SOCKET_PATH);
		const timeout = setTimeout(() => {
			conn.destroy();
			resolve(false);
		}, 2000);

		conn.on("connect", () => {
			conn.end(JSON.stringify({ ping: true }), "utf-8");
		});

		conn.on("data", () => {
			clearTimeout(timeout);
			conn.destroy();
			resolve(true);
		});

		conn.on("error", () => {
			clearTimeout(timeout);
			resolve(false);
		});
	});
}

/**
 * Find the venv Python that has mlx-audio installed.
 */
function findVenvPython(): string {
	const scriptDir = path.dirname(SERVER_SCRIPT);
	const venvPython = path.join(scriptDir, "..", ".venv", "bin", "python3");
	if (fs.existsSync(venvPython)) {
		return path.resolve(venvPython);
	}
	return "python3";
}

/**
 * Start the TTS server daemon and wait for it to be ready.
 * Resolves true if server started successfully, false otherwise.
 */
function startServer(): Promise<boolean> {
	return new Promise((resolve) => {
		if (!fs.existsSync(SERVER_SCRIPT)) {
			console.error("[tts-bridge] Server script not found:", SERVER_SCRIPT);
			resolve(false);
			return;
		}

		const pythonBin = findVenvPython();
		console.log(`[tts-bridge] Starting TTS server daemon using ${pythonBin}...`);

		cp.execFile(pythonBin, [SERVER_SCRIPT, "--daemon"], { timeout: 10_000 }, (err) => {
			if (err) {
				console.error("[tts-bridge] Failed to start server daemon:", err);
				clearInterval(poll);
				resolve(false);
			}
		});

		// Poll for socket to appear, then ping to confirm server is ready
		const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
		const poll = setInterval(async () => {
			if (fs.existsSync(SOCKET_PATH) && await pingServer()) {
				clearInterval(poll);
				resolve(true);
			} else if (Date.now() > deadline) {
				clearInterval(poll);
				console.error("[tts-bridge] Server did not start in time.");
				resolve(false);
			}
		}, 500);
	});
}

let pendingEnsure: Promise<boolean> | undefined;

/**
 * Ensure the TTS server is running. Starts it if needed.
 * Concurrent calls are coalesced into a single startup attempt.
 * Returns true if server is available, false otherwise.
 */
export async function ensureServer(): Promise<boolean> {
	if (pendingEnsure) return pendingEnsure;
	pendingEnsure = ensureServerImpl();
	try {
		return await pendingEnsure;
	} finally {
		pendingEnsure = undefined;
	}
}

async function ensureServerImpl(): Promise<boolean> {
	// Fast path: socket exists and server responds to ping
	if (fs.existsSync(SOCKET_PATH)) {
		if (await pingServer()) {
			return true;
		}
		// Socket exists but server is dead — clean up
		console.log("[tts-bridge] Stale socket detected, cleaning up...");
		cleanupStaleFiles();
	}

	// Server not running — try to start it
	return startServer();
}

/**
 * Streams TTS audio from the Kokoro server.
 * Automatically starts the server if it's not running.
 * Calls onChunk with base64-encoded float32 PCM data for each sentence.
 * Calls onEnd when the stream completes.
 * Returns a function to abort the stream.
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
		if (!(await ensureServer())) {
			if (!aborted) onError(new Error("TTS server unavailable"));
			return;
		}
		if (aborted) return;
		conn = connectAndStream(text, options, onChunk, onEnd, onError, () => aborted);
	};

	run();

	return () => {
		aborted = true;
		if (conn) conn.destroy();
	};
}

/**
 * Internal: connect to the running server and stream audio.
 */
function connectAndStream(
	text: string,
	options: TTSOptions,
	onChunk: (base64Data: string, sampleRate: number) => void,
	onEnd: () => void,
	onError: (err: Error) => void,
	isAborted: () => boolean,
): net.Socket {
	let ended = false;

	const conn = net.createConnection(SOCKET_PATH);

	conn.on("connect", () => {
		const request = JSON.stringify({
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
 * Check if the TTS server is available (quick, non-blocking check).
 * For a more reliable check that auto-starts the server, use streamTTS directly.
 */
export function isTTSAvailable(): boolean {
	// If socket exists and process is alive, likely available
	if (fs.existsSync(SOCKET_PATH) && isServerProcessAlive()) {
		return true;
	}
	// Even if server is down, we can auto-start it — so report available
	// if the server script exists (meaning TTS is installed)
	return fs.existsSync(SERVER_SCRIPT);
}
