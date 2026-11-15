import { execFileSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CONFIG_DIR, writeJSON } from "../util/storage";
import {
	GUI_FILE, pokeDaemon, readDaemonState, readServiceConfig, removeFile, runningGuiPid, ServiceConfig, writeServiceConfig,
} from "./shared";

const UNIT_NAME = "nippletuner.service";
const UNIT_FILE = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "systemd", "user", UNIT_NAME);

/** Command that undoes everything from a terminal. */
export const REVERT_COMMAND = `systemctl --user disable --now ${UNIT_NAME} && rm ${UNIT_FILE}`;

function systemctl(...args: string[]): { ok: boolean; out: string } {
	const r = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
	return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/**
 * The service runs under plain Node (qode only runs JS timers once a window
 * has been shown, so it can't host a windowless service). Find a Node ≥ 18.
 */
function findNode(): string | null {
	const candidates: string[] = [];
	for (const dir of (process.env.PATH ?? "").split(":")) if (dir) candidates.push(path.join(dir, "node"));
	const nvm = path.join(os.homedir(), ".nvm", "versions", "node");
	try {
		const versions = fs.readdirSync(nvm).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
		for (const v of versions) candidates.push(path.join(nvm, v, "bin", "node"));
	} catch { /* no nvm */ }
	candidates.push("/usr/local/bin/node", "/usr/bin/node");
	for (const c of candidates) {
		try {
			fs.accessSync(c, fs.constants.X_OK);
			const major = Number(execFileSync(c, ["-p", "process.versions.node.split('.')[0]"], { encoding: "utf8" }).trim());
			if (major >= 18) return c;
		} catch { /* not usable */ }
	}
	return null;
}

/**
 * Optional systemd user service that keeps the applied profile running when
 * the GUI is closed (see src/daemon.ts). The GUI and service never fight over
 * the TrackPoint: while the GUI runs it owns the device and the service waits.
 */
export default class BackgroundService {
	/** The unit file exists (state is read fresh each time). */
	get installed(): boolean {
		return fs.existsSync(UNIT_FILE);
	}

	/** Installs, enables and starts the service. Throws with a readable message on failure. */
	install(): void {
		const node = findNode();
		if (!node) throw new Error("Couldn't find Node.js 18 or newer, which the background service needs.");
		// __filename is dist/main.cjs; the service bundle sits next to it.
		const daemon = path.join(path.dirname(path.resolve(__filename)), "daemon.cjs");
		if (!fs.existsSync(daemon)) throw new Error(`The service program is missing (${daemon}). Run "npm run build" first.`);
		const env = ["DISPLAY", "XAUTHORITY"]
			.filter((k) => process.env[k])
			.map((k) => `Environment=${k}=${process.env[k]}`);

		fs.mkdirSync(path.dirname(UNIT_FILE), { recursive: true });
		fs.writeFileSync(UNIT_FILE, [
			"[Unit]",
			"Description=NippleTuner: keeps the applied TrackPoint profile running when the app is closed",
			"",
			"[Service]",
			"Type=simple",
			`ExecStart="${node}" "${daemon}"`,
			`WorkingDirectory=${path.dirname(path.dirname(daemon))}`,
			...env,
			"Restart=on-failure",
			"RestartSec=3",
			"",
			"[Install]",
			"WantedBy=default.target",
			"",
		].join("\n"));

		systemctl("daemon-reload");
		const r = systemctl("enable", "--now", UNIT_NAME);
		if (!r.ok) throw new Error(`systemctl couldn't start the service:\n${r.out}`);
	}

	/** Stops, disables and removes the service and what it was applying. */
	uninstall(): void {
		systemctl("disable", "--now", UNIT_NAME);
		try {
			fs.unlinkSync(UNIT_FILE);
		} catch { /* already gone */ }
		systemctl("daemon-reload");
		writeServiceConfig(null);
	}

	/** What the service would run (null = nothing). */
	get config(): ServiceConfig | null {
		return readServiceConfig();
	}

	/** Sets what the service runs once the GUI closes (null = nothing). */
	setConfig(c: ServiceConfig | null): void {
		const before = JSON.stringify(readServiceConfig());
		if (JSON.stringify(c) === before) return;
		writeServiceConfig(c);
	}

	/**
	 * Marks this GUI as the running instance: the service steps aside, and
	 * a second launch hands over to this one instead of starting again.
	 */
	claimDevice(): void {
		fs.mkdirSync(CONFIG_DIR, { recursive: true });
		writeJSON(GUI_FILE, { pid: process.pid, at: Date.now() });
		pokeDaemon();
	}

	/** GUI is closing: let the service take over again right away. */
	releaseDevice(): void {
		if (runningGuiPid() === process.pid || runningGuiPid() === null) removeFile(GUI_FILE);
		pokeDaemon();
	}

	/**
	 * Calls `then` once the service no longer holds the TrackPoint (or after
	 * `timeoutMs`), so the GUI can grab it without a conflict.
	 */
	whenDeviceFree(then: () => void, timeoutMs = 3000): void {
		const start = Date.now();
		const check = () => {
			const d = readDaemonState();
			if (!d || !d.active || Date.now() - start > timeoutMs) then();
			else setTimeout(check, 100);
		};
		check();
	}
}
