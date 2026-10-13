import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { ensureServer, setWorkspaceRoot, streamTTS } from "../src/tts-bridge";
import { Endpoint, readEndpoint } from "../src/tts/endpoint";

const repoRoot = path.resolve(__dirname, "..", "..");
let stateDir: string;

/** Ask a server to exit, resolving once it has answered or closed. */
function shutdown(ep: Endpoint): Promise<void> {
	return new Promise((resolve) => {
		const conn = net.createConnection({ host: ep.host, port: ep.port }, () =>
			conn.end(JSON.stringify({ token: ep.token, shutdown: true })),
		);
		conn.resume(); // drain the reply so the socket can emit "close"
		conn.on("close", () => resolve());
		conn.on("error", () => resolve());
	});
}

/** Return a port nothing listens on. */
function closedPort(): Promise<number> {
	return new Promise((resolve) => {
		const srv = net.createServer().listen(0, "127.0.0.1", () => {
			const { port } = srv.address() as net.AddressInfo;
			srv.close(() => resolve(port));
		});
	});
}

describe("tts-bridge against the real Python server (fake backend)", () => {
	beforeAll(() => {
		stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ce-tts-"));
		process.env.CODE_EXPLAINER_STATE_DIR = stateDir;
		process.env.TTS_BACKEND = "fake";
		process.env.TTS_IDLE_TIMEOUT = "60";
		setWorkspaceRoot(repoRoot);
	});

	afterAll(async () => {
		const ep = readEndpoint();
		if (ep) await shutdown(ep);
		fs.rmSync(stateDir, { recursive: true, force: true });
	});

	it("replaces a stale endpoint and starts a server", async () => {
		const stale = { host: "127.0.0.1", port: await closedPort(), token: "stale", pid: 999999 };
		fs.writeFileSync(path.join(stateDir, "tts-server.json"), JSON.stringify(stale));
		expect(await ensureServer()).toBe(true);
		expect(readEndpoint()?.port).not.toBe(stale.port);
	}, 60_000);

	it("streams one chunk per sentence", async () => {
		const chunks: Buffer[] = [];
		await new Promise<void>((resolve, reject) => {
			streamTTS(
				"One. Two.",
				{ voice: "af_heart", speed: 1 },
				(b64, rate) => { expect(rate).toBe(24000); chunks.push(Buffer.from(b64, "base64")); },
				resolve,
				reject,
			);
		});
		expect(chunks).toHaveLength(2);
		expect(chunks[0].length).toBe(2400 * 4);
	}, 60_000);
});
