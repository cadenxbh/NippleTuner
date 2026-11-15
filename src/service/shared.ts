/**
 * Files shared by the GUI and the background service (src/daemon.ts).
 * Kept free of Qt imports so the service can run under plain Node.
 *
 *   service.json  what the service should run (written by the GUI on apply)
 *   gui.json      the GUI's pid while it runs — the service steps aside then
 *   daemon.json   the service's pid and whether it currently holds the device
 */
import * as fs from "fs";
import * as path from "path";
import { AccelCurveJSON } from "../pointer";
import { CONFIG_DIR, readJSON, writeJSON } from "../util/storage";

export interface ServiceConfig {
	profileId: string;
	profileName: string;
	curve: AccelCurveJSON;
	sens: { x: number; y: number };
}

export interface ProcessMark {
	pid: number;
	at: number;
}

export interface DaemonState extends ProcessMark {
	/** True while the service has the TrackPoint grabbed and is applying the curve. */
	active: boolean;
}

export const SERVICE_FILE = "service.json";
export const GUI_FILE = "gui.json";
export const DAEMON_FILE = "daemon.json";

export const servicePath = (name: string) => path.join(CONFIG_DIR, name);

export function readServiceConfig(): ServiceConfig | null {
	const c = readJSON<ServiceConfig | null>(SERVICE_FILE, null);
	return c && c.curve && Array.isArray(c.curve.points) ? c : null;
}

export function writeServiceConfig(c: ServiceConfig | null): void {
	if (c) writeJSON(SERVICE_FILE, c);
	else removeFile(SERVICE_FILE);
}

export function removeFile(name: string): void {
	try {
		fs.unlinkSync(servicePath(name));
	} catch { /* already gone */ }
}

/**
 * True if `pid` is alive and one of its arguments is the script `scriptName`
 * (guards against a stale pid file pointing at an unrelated process).
 */
export function processAlive(pid: number, scriptName: string): boolean {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		const args = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
		return args.some((a) => a === scriptName || a.endsWith(`/${scriptName}`));
	} catch {
		return false;
	}
}

/** The GUI is running (its pid file exists and the process is alive). */
export function guiRunning(): boolean {
	return runningGuiPid() !== null;
}

/** Pid of the running NippleTuner GUI, or null. */
export function runningGuiPid(): number | null {
	const g = readJSON<ProcessMark | null>(GUI_FILE, null);
	return g && processAlive(g.pid, "main.cjs") ? g.pid : null;
}

export function readDaemonState(): DaemonState | null {
	const d = readJSON<DaemonState | null>(DAEMON_FILE, null);
	return d && processAlive(d.pid, "daemon.cjs") ? d : null;
}

/** Asks the service to re-check right away (instead of on its next poll). */
export function pokeDaemon(): void {
	const d = readDaemonState();
	if (d) {
		try {
			process.kill(d.pid, "SIGUSR1");
		} catch { /* gone */ }
	}
}
