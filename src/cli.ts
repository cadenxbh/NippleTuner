/**
 * nippletuner — command-line control for NippleTuner (good for hotkeys).
 *
 *   nippletuner next            apply the next profile
 *   nippletuner apply Gaming    apply a profile by name / prefix / number
 *   nippletuner toggle          off ↔ last profile
 *   nippletuner help            everything else
 *
 * Talks to the running app over a Unix socket. If the app isn't running but
 * the background service is installed, profile commands update what the
 * service runs instead (so hotkeys keep working with the window closed).
 * Runs under plain Node: no Qt here.
 */
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { COMMAND_HELP } from "./app/Commands";
import StickRange from "./app/StickRange";
import { buildTuning } from "./app/tuning";
import CurveLibrary from "./curves/CurveLibrary";
import { PointerDevice } from "./pointer";
import ProfileStore, { Profile } from "./profiles/ProfileStore";
import { resolveDevice } from "./settings/deviceChoice";
import AppSettings from "./settings/AppSettings";
import BackgroundService from "./service/BackgroundService";
import { send, Request, Response } from "./service/ipc";
import { cycleProfile, findProfile, lastAppliedId, rememberApplied } from "./service/profileOps";
import { readDaemonState } from "./service/shared";

const PROJECT_DIR = path.dirname(path.dirname(path.resolve(__filename))); // dist/cli.cjs → project
const QODE = path.join(PROJECT_DIR, "node_modules", "@nodegui", "qode", "binaries", "qode");
const MAIN = path.join(PROJECT_DIR, "dist", "main.cjs");
const WRAPPER = path.join(PROJECT_DIR, "bin", "nippletuner");

function usage(): string {
	const width = Math.max(...COMMAND_HELP.map(([c]) => c.length), "install-cli".length) + 2;
	return [
		"Usage: nippletuner <command> [--quiet] [--json]",
		"",
		"Commands:",
		...COMMAND_HELP.map(([c, d]) => `  ${c.padEnd(width)}${d}`),
		`  ${"start".padEnd(width)}start NippleTuner in the tray (if it isn't running)`,
		`  ${"install-cli".padEnd(width)}link this command into ~/.local/bin so \`nippletuner\` works anywhere`,
		"",
		"Options:",
		"  --quiet   don't show a desktop notification for the change",
		"  --json    print machine-readable output",
		"",
		"Profiles can be given by name, a unique start of the name, or their number from `list`.",
		"Hotkeys: bind e.g. `nippletuner next` in System Settings → Keyboard → Shortcuts → Custom Shortcuts.",
	].join("\n");
}

function launchGui(show: boolean): void {
	if (!fs.existsSync(QODE) || !fs.existsSync(MAIN)) throw new Error(`NippleTuner isn't built (missing ${MAIN}). Run "npm run build".`);
	spawn(QODE, [MAIN, ...(show ? ["--show"] : [])], { cwd: PROJECT_DIR, detached: true, stdio: "ignore" }).unref();
}

/** Same as the app's command handler, but against the background service. */
function offline(req: Request): Response {
	const profiles = new ProfileStore();
	const service = new BackgroundService();
	const svc = service.config;
	const applied = svc ? profiles.get(svc.profileId) : undefined;
	const running = !!readDaemonState()?.active;

	switch (req.cmd) {
		case "status":
			return {
				ok: true,
				message: [
					"NippleTuner window: not running",
					`Background service: ${service.installed ? (running ? "running (applying a profile)" : "installed, idle") : "not installed"}`,
					`Applied: ${applied ? applied.name : "nothing (TrackPoint unchanged)"}`,
				].join("\n"),
				data: { gui: false, service: service.installed, applied: applied ? { id: applied.id, name: applied.name } : null },
			};
		case "list": {
			const all = profiles.all;
			if (!all.length) return { ok: true, message: "No saved profiles yet.", data: [] };
			return {
				ok: true,
				message: all.map((p, i) => `${p.id === applied?.id ? "*" : " "} ${i + 1}. ${p.name}`).join("\n"),
				data: all.map((p) => ({ id: p.id, name: p.name, applied: p.id === applied?.id })),
			};
		}
		case "apply":
		case "set":
		case "next":
		case "prev":
		case "toggle":
		case "off": {
			if (!service.installed) {
				return {
					ok: false,
					message:
						"NippleTuner isn't running, so there's nothing to change.\n" +
						"Start it with `nippletuner start`, or turn on Preferences → \"Keep Applied Profile Running When Closed\" " +
						"so profile hotkeys also work while it's closed.",
				};
			}
			let target: Profile | null;
			if (req.cmd === "off" || (req.cmd === "toggle" && applied)) target = null;
			else if (req.cmd === "toggle") {
				const id = [lastAppliedId(), profiles.active?.id, profiles.all[0]?.id].find((i) => i && profiles.get(i));
				target = id ? profiles.get(id)! : null;
				if (!target) return { ok: false, message: "There are no saved profiles to turn on." };
			} else if (req.cmd === "next" || req.cmd === "prev") target = cycleProfile(profiles.all, applied?.id ?? null, req.cmd === "next" ? 1 : -1);
			else {
				if (!req.args.length) return { ok: false, message: "Which profile? Usage: apply <name|number>" };
				target = findProfile(profiles.all, req.args.join(" "));
			}

			if (!target) {
				service.setConfig(null);
				return { ok: true, message: "Turned off (TrackPoint back to normal)." };
			}
			// Build the curve exactly like the app does, for the chosen device.
			const { info } = resolveDevice(new AppSettings().deviceKey);
			const range = new StickRange(info ? new PointerDevice(info) : null);
			const t = buildTuning(target, new CurveLibrary(), range.maxSpeed);
			service.setConfig({ profileId: target.id, profileName: target.name, curve: t.curve.toJSON(), sens: t.sens });
			rememberApplied(target.id);
			return { ok: true, message: `Applied "${target.name}" (via the background service).` };
		}
		case "show":
		case "toggle-window":
			launchGui(true);
			return { ok: true, message: "Starting NippleTuner…" };
		case "hide":
		case "quit":
			return { ok: true, message: "NippleTuner isn't running." };
		default:
			return { ok: false, message: `Unknown command "${req.cmd}". Try: nippletuner help` };
	}
}

function installCli(): Response {
	const binDir = path.join(os.homedir(), ".local", "bin");
	const link = path.join(binDir, "nippletuner");
	fs.mkdirSync(binDir, { recursive: true });
	try {
		fs.unlinkSync(link);
	} catch { /* none */ }
	fs.symlinkSync(WRAPPER, link);
	const onPath = (process.env.PATH ?? "").split(":").includes(binDir);
	return {
		ok: true,
		message: `Linked ${link} → ${WRAPPER}` + (onPath ? "" : `\n(${binDir} isn't on your PATH yet; it usually is after logging out and back in.)`),
	};
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const json = argv.includes("--json");
	const notify = !argv.includes("--quiet");
	const [cmd = "help", ...args] = argv.filter((a) => !a.startsWith("--"));

	let res: Response;
	if (cmd === "help" || cmd === "-h") {
		console.log(usage());
		return 0;
	} else if (cmd === "install-cli") {
		res = installCli();
	} else if (cmd === "start") {
		try {
			res = await send({ cmd: "status", args: [] });
			res = { ok: true, message: "NippleTuner is already running." };
		} catch {
			launchGui(false);
			res = { ok: true, message: "Started NippleTuner (in the tray)." };
		}
	} else {
		const req: Request = { cmd, args, notify };
		try {
			res = await send(req);
		} catch (err: any) {
			if (["ENOENT", "ECONNREFUSED"].includes(err?.code)) {
				try {
					res = offline(req);
				} catch (e: any) {
					res = { ok: false, message: e?.message ?? String(e) };
				}
			} else {
				res = { ok: false, message: err?.message ?? String(err) };
			}
		}
	}

	if (json) console.log(JSON.stringify(res));
	else (res.ok ? console.log : console.error)(res.message);
	return res.ok ? 0 : 1;
}

main().then((code) => process.exit(code));
