import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseEndpoint, readEndpoint, removeEndpoint } from "../src/tts/endpoint";

const valid = { host: "127.0.0.1", port: 5000, token: "t", pid: 42 };

describe("endpoint", () => {
	it("parses a valid file", () => {
		expect(parseEndpoint(JSON.stringify(valid))).toEqual(valid);
	});

	it.each(["", "nope", "[]", JSON.stringify({ ...valid, port: "5000" }), JSON.stringify({ host: "x" })])(
		"rejects malformed content %j",
		(raw) => { expect(parseEndpoint(raw)).toBeUndefined(); },
	);

	it("reads, keeps on PID mismatch, and removes on PID match", () => {
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ce-ep-")), "tts-server.json");
		expect(readEndpoint(file)).toBeUndefined();
		fs.writeFileSync(file, JSON.stringify(valid));
		expect(readEndpoint(file)).toEqual(valid);
		removeEndpoint(43, file);
		expect(readEndpoint(file)).toEqual(valid);
		removeEndpoint(42, file);
		expect(fs.existsSync(file)).toBe(false);
		removeEndpoint(undefined, file);
	});
});
