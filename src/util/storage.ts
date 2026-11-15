import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** ~/.config/NippleTuner (or $XDG_CONFIG_HOME/NippleTuner). */
export const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "NippleTuner");

export function readJSON<T>(name: string, fallback: T): T {
	try {
		return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), "utf8")) as T;
	} catch {
		return fallback;
	}
}

/** Atomic write (temp file + rename) so a crash never leaves half a file. */
export function writeJSON(name: string, data: unknown): void {
	fs.mkdirSync(CONFIG_DIR, { recursive: true });
	const file = path.join(CONFIG_DIR, name);
	fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 2));
	fs.renameSync(file + ".tmp", file);
}

/** "Name", "Name (2)", "Name (3)"… — first one not in `taken`. */
export function uniqueName(name: string, taken: string[]): string {
	const base = name.trim() || "Untitled";
	if (!taken.includes(base)) return base;
	for (let i = 2; ; i++) {
		const n = `${base} (${i})`;
		if (!taken.includes(n)) return n;
	}
}

export function newId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
