/**
 * NippleTuner background service: keeps the applied profile running while
 * the GUI isn't open. Runs under plain Node (no Qt), started by the systemd
 * user unit the GUI installs (Preferences → Keep Applied Profile Running…).
 *
 * Every second (or immediately on SIGUSR1) it decides:
 *   GUI running, or no service.json → release the TrackPoint completely
 *   otherwise                       → grab it and apply service.json's curve
 * If anything goes wrong the kernel releases the grab when this process
 * exits, so the TrackPoint always falls back to normal behaviour.
 */
import * as fs from "fs";
import { AccelCurve, flattenXInputAccel, PointerDevice } from "./pointer";
import { DAEMON_FILE, guiRunning, readServiceConfig, removeFile, servicePath, SERVICE_FILE } from "./service/shared";
import { writeJSON } from "./util/storage";
import AppSettings from "./settings/AppSettings";
import { resolveDevice } from "./settings/deviceChoice";

const POLL_MS = 1000;
const REFLATTEN_MS = 15000;

let tp: PointerDevice | null = null;
let appliedKey = "";
let lastFlatten = 0;
let lastError = "";

function log(msg: string): void {
	console.log(`[nippletuner-daemon] ${msg}`);
}

function writeState(active: boolean): void {
	try {
		writeJSON(DAEMON_FILE, { pid: process.pid, at: Date.now(), active });
	} catch { /* config dir not writable: nothing useful to do */ }
}

function release(reason: string): void {
	if (!tp) return;
	log(`releasing TrackPoint (${reason})`);
	try {
		tp.disableCurve();
		tp.stop();
	} catch { /* ignore */ }
	tp = null;
	appliedKey = "";
}

function tick(): void {
	const cfg = readServiceConfig();
	const gui = guiRunning();
	if (!cfg || gui) {
		release(gui ? "the NippleTuner window is running" : "no profile to apply");
		writeState(false);
		return;
	}

	try {
		if (!tp || !tp.isRunning) {
			// Same device the GUI uses (Preferences → Device), read fresh each time.
			const { info } = resolveDevice(new AppSettings().deviceKey);
			if (!info) throw new Error("no matching pointer device is connected");
			tp = new PointerDevice(info);
			tp.on("error", (err) => {
				log(`device error: ${err.message}`);
				tp = null; // reopen on the next tick (e.g. after resume)
				appliedKey = "";
			});
			tp.start();
		}
		const key = JSON.stringify([cfg.curve, cfg.sens]);
		if (key !== appliedKey) {
			tp.setCurve(AccelCurve.fromJSON(cfg.curve));
			tp.setAxisSensitivity(cfg.sens.x, cfg.sens.y);
			appliedKey = key;
			log(`applying profile "${cfg.profileName}"`);
		}
		if (!tp.isCurveEnabled) {
			tp.enableCurve();
			lastFlatten = Date.now();
		} else if (Date.now() - lastFlatten > REFLATTEN_MS) {
			// The desktop may have reset the virtual device's acceleration (e.g.
			// after the X session started); keep it flat so the curve isn't doubled.
			flattenXInputAccel(tp.virtualDeviceName);
			lastFlatten = Date.now();
		}
		lastError = "";
		writeState(true);
	} catch (err: any) {
		const msg = err?.message ?? String(err);
		if (msg !== lastError) log(`can't apply yet: ${msg}`);
		lastError = msg;
		release("error");
		writeState(false);
	}
}

function shutdown(): void {
	release("service stopping");
	removeFile(DAEMON_FILE);
	process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGUSR1", () => tick());

// React quickly when the GUI changes the profile.
try {
	fs.watch(servicePath(""), (_e, file) => {
		if (file === SERVICE_FILE) setTimeout(tick, 50);
	});
} catch { /* config dir may not exist yet; polling still works */ }

log("started");
tick();
setInterval(tick, POLL_MS);
