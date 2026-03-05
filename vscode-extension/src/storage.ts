import * as fs from "fs";
import * as path from "path";
import { Segment } from "./types";

export interface WalkthroughFile {
	title: string;
	segments: Segment[];
}

export class WalkthroughStorage {
	private readonly walkthroughsDir: string;

	constructor(private readonly workspaceRoot: string) {
		this.walkthroughsDir = path.join(workspaceRoot, ".walkthroughs");
	}

	/** Lowercase, replace non-alphanumeric with hyphens, trim leading/trailing hyphens. */
	static slugify(title: string): string {
		return title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			|| "walkthrough";
	}

	/** Convert absolute `file` paths to relative (from workspace root). */
	private toRelativePaths(segments: Segment[]): Segment[] {
		return segments.map((s) => ({
			...s,
			file: path.relative(this.workspaceRoot, s.file),
		}));
	}

	/** Convert relative `file` paths to absolute (from workspace root). */
	private toAbsolutePaths(segments: Segment[]): Segment[] {
		return segments.map((s) => ({
			...s,
			file: path.resolve(this.workspaceRoot, s.file),
		}));
	}

	/**
	 * Save a walkthrough to disk.
	 * @param title  Display title stored inside the JSON.
	 * @param segments  Segments with absolute file paths.
	 * @param name  Optional file stem; defaults to slugified title.
	 * @returns The absolute path of the written JSON file.
	 */
	async save(
		title: string,
		segments: Segment[],
		name?: string,
	): Promise<string> {
		await fs.promises.mkdir(this.walkthroughsDir, { recursive: true });

		const slug = WalkthroughStorage.slugify(name ?? title);
		const filePath = path.join(this.walkthroughsDir, `${slug}.json`);

		const data: WalkthroughFile = {
			title,
			segments: this.toRelativePaths(segments),
		};

		await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
		return filePath;
	}

	/** Check whether a walkthrough file exists for the given title or name. */
	async exists(titleOrName: string): Promise<boolean> {
		const slug = WalkthroughStorage.slugify(titleOrName);
		const filePath = path.join(this.walkthroughsDir, `${slug}.json`);
		try {
			await fs.promises.access(filePath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Load a walkthrough by name.
	 * @returns The walkthrough with absolute file paths, or null if not found.
	 */
	async load(name: string): Promise<{ title: string; segments: Segment[] } | null> {
		const slug = WalkthroughStorage.slugify(name);
		const filePath = path.join(this.walkthroughsDir, `${slug}.json`);
		try {
			const raw = await fs.promises.readFile(filePath, "utf-8");
			const data = JSON.parse(raw);
			if (typeof data.title !== "string" || !Array.isArray(data.segments)) {
				return null;
			}
			return {
				title: data.title,
				segments: this.toAbsolutePaths(data.segments),
			};
		} catch (err: unknown) {
			if (err && typeof err === "object" && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw err;
		}
	}

	/** List all saved walkthroughs. */
	async list(): Promise<Array<{ name: string; title: string; filePath: string }>> {
		try {
			const entries = await fs.promises.readdir(this.walkthroughsDir);
			const jsonFiles = entries.filter((e) => e.endsWith(".json"));

			const results: Array<{ name: string; title: string; filePath: string }> = [];

			for (const file of jsonFiles) {
				const filePath = path.join(this.walkthroughsDir, file);
				try {
					const raw = await fs.promises.readFile(filePath, "utf-8");
					const data: WalkthroughFile = JSON.parse(raw);
					results.push({
						name: path.basename(file, ".json"),
						title: data.title,
						filePath,
					});
				} catch {
					// Skip malformed files
				}
			}

			return results;
		} catch {
			return [];
		}
	}
}
