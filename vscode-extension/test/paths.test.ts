import { afterEach, describe, expect, it } from "vitest";
import * as os from "os";
import * as path from "path";
import { endpointFile, stateDir, systemPython, venvPython } from "../src/tts/paths";

describe("paths", () => {
	afterEach(() => { delete process.env.CODE_EXPLAINER_STATE_DIR; });

	it("defaults the state dir under the home directory (same as paths.py)", () => {
		delete process.env.CODE_EXPLAINER_STATE_DIR;
		expect(stateDir()).toBe(path.join(os.homedir(), ".code-explainer", "run"));
	});

	it("honors the override and keeps the endpoint inside it", () => {
		process.env.CODE_EXPLAINER_STATE_DIR = "/x/state";
		expect(endpointFile()).toBe(path.join("/x/state", "tts-server.json"));
	});

	it("uses the OS-specific venv layout", () => {
		expect(venvPython("C:\\proj", "win32")).toBe("C:\\proj\\.venv\\Scripts\\python.exe");
		expect(venvPython("/proj", "linux")).toBe("/proj/.venv/bin/python3");
		expect(venvPython("/proj", "darwin")).toBe("/proj/.venv/bin/python3");
	});

	it("falls back to the OS's python command", () => {
		expect(systemPython("win32")).toBe("python");
		expect(systemPython("linux")).toBe("python3");
	});
});
