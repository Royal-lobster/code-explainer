import * as fs from "fs";
import { endpointFile } from "./paths";

/** Where a TTS server listens and the token it requires (see scripts/codeexplainer/endpoint.py). */
export interface Endpoint {
	host: string;
	port: number;
	token: string;
	pid: number;
}

/**
 * Parse endpoint file content.
 * @param raw - File content.
 * @returns The endpoint, or undefined if malformed.
 */
export function parseEndpoint(raw: string): Endpoint | undefined {
	try {
		const d = JSON.parse(raw);
		if (
			d && typeof d === "object" &&
			typeof d.host === "string" && Number.isInteger(d.port) &&
			typeof d.token === "string" && Number.isInteger(d.pid)
		) {
			return { host: d.host, port: d.port, token: d.token, pid: d.pid };
		}
	} catch {}
	return undefined;
}

/**
 * Read the published endpoint.
 * @param file - Endpoint file; defaults to the shared location.
 * @returns The endpoint, or undefined if missing or malformed.
 */
export function readEndpoint(file: string = endpointFile()): Endpoint | undefined {
	try {
		return parseEndpoint(fs.readFileSync(file, "utf-8"));
	} catch {
		return undefined;
	}
}

/**
 * Delete the endpoint file.
 * @param onlyIfPid - If set, delete only when the file still names this PID.
 * @param file - Endpoint file; defaults to the shared location.
 */
export function removeEndpoint(onlyIfPid?: number, file: string = endpointFile()): void {
	if (onlyIfPid !== undefined) {
		const current = readEndpoint(file);
		if (current && current.pid !== onlyIfPid) return;
	}
	try {
		fs.unlinkSync(file);
	} catch {}
}
