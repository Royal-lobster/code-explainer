import * as net from "net";
import * as fs from "fs";

const SOCKET_PATH = "/tmp/tts-server.sock";
const SAMPLE_RATE = 24000;

export interface TTSOptions {
	voice: string;
	speed: number;
}

/**
 * Streams TTS audio from the Kokoro server.
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
		if (aborted) return;

		buffer = Buffer.concat([buffer, data]);

		// Process all complete messages in the buffer
		while (buffer.length >= 4) {
			if (waitingForHeader) {
				expectedLength = buffer.readUInt32BE(0);
				buffer = buffer.subarray(4);

				if (expectedLength === 0) {
					// End-of-stream marker
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

				// Convert raw bytes to base64
				onChunk(audioBytes.toString("base64"), SAMPLE_RATE);
			} else {
				break; // Need more data
			}
		}
	});

	conn.on("error", (err) => {
		if (!aborted) onError(err);
	});

	conn.on("close", () => {
		// If we didn't get an end marker, still signal end
		if (!aborted && waitingForHeader && buffer.length === 0) {
			onEnd();
		}
	});

	return () => {
		aborted = true;
		conn.destroy();
	};
}

/**
 * Check if the TTS server is available.
 */
export function isTTSAvailable(): boolean {
	try {
		return fs.existsSync(SOCKET_PATH);
	} catch {
		return false;
	}
}
