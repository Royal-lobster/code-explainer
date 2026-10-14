import * as os from "os";
import * as path from "path";

/** Env var overriding the runtime state directory (mirrors scripts/codeexplainer/paths.py). */
export const STATE_DIR_ENV = "CODE_EXPLAINER_STATE_DIR";

/**
 * Directory holding the TTS server endpoint file and log.
 * Must resolve to the same path as `state_dir()` in scripts/codeexplainer/paths.py.
 * @returns Absolute path; the Python server creates it.
 */
export function stateDir(): string {
	return process.env[STATE_DIR_ENV] || path.join(os.homedir(), ".code-explainer", "run");
}

/**
 * File in which the running TTS server advertises its port and token.
 * @returns Absolute path to `tts-server.json`.
 */
export function endpointFile(): string {
	return path.join(stateDir(), "tts-server.json");
}

/**
 * Interpreter inside `<projectRoot>/.venv` for an OS.
 * @param projectRoot - Directory containing `.venv`.
 * @param platform - Target platform; defaults to the current one.
 * @returns `Scripts\python.exe` on Windows, `bin/python3` elsewhere.
 */
export function venvPython(projectRoot: string, platform: NodeJS.Platform = process.platform): string {
	return platform === "win32"
		? path.win32.join(projectRoot, ".venv", "Scripts", "python.exe")
		: path.posix.join(projectRoot, ".venv", "bin", "python3");
}

/**
 * Python command to use when no venv is found.
 * @param platform - Target platform; defaults to the current one.
 * @returns `python` on Windows, `python3` elsewhere.
 */
export function systemPython(platform: NodeJS.Platform = process.platform): string {
	return platform === "win32" ? "python" : "python3";
}
