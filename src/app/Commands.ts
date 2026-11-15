import ProfileStore from "../profiles/ProfileStore";
import { Request, Response } from "../service/ipc";
import { cycleProfile, findProfile, lastAppliedId } from "../service/profileOps";
import DeviceController from "./DeviceController";

export interface CommandHost {
	profiles: ProfileStore;
	device: DeviceController;
	deviceName: () => string | null;
	showWindow: () => void;
	hideWindow: () => void;
	windowVisible: () => boolean;
	quit: () => void;
	notify: (title: string, message: string) => void;
}

export const COMMAND_HELP: [string, string][] = [
	["status", "what's applied, which device, whether a test is running"],
	["list", "saved profiles (numbered; * = applied)"],
	["apply <profile>", "apply a profile by name, unique prefix, or number from `list`"],
	["next / prev", "apply the next / previous profile (wraps around)"],
	["toggle", "turn off, or re-apply the last profile if off"],
	["off", "stop applying any profile (TrackPoint back to normal)"],
	["show / hide / toggle-window", "show or hide the NippleTuner window"],
	["quit", "quit NippleTuner"],
];

/** Runs CLI requests against the running app. */
export default class Commands {
	constructor(private host: CommandHost) {}

	handle(req: Request): Response {
		const { profiles, device } = this.host;
		const [arg] = req.args;
		const applied = () => (device.appliedProfileId ? profiles.get(device.appliedProfileId) : undefined);

		switch (req.cmd) {
			case "status": {
				const a = applied();
				return {
					ok: true,
					message: [
						`Applied:  ${a ? a.name : "nothing (TrackPoint unchanged)"}`,
						`Testing:  ${device.testing ? "yes (unsaved settings)" : "no"}`,
						`Device:   ${this.host.deviceName() ?? "none available"}`,
						`Window:   ${this.host.windowVisible() ? "shown" : "hidden"}`,
					].join("\n"),
					data: { applied: a ? { id: a.id, name: a.name } : null, testing: device.testing, device: this.host.deviceName() },
				};
			}
			case "list": {
				const all = profiles.all;
				if (!all.length) return { ok: true, message: "No saved profiles yet.", data: [] };
				return {
					ok: true,
					message: all.map((p, i) => `${p.id === device.appliedProfileId ? "*" : " "} ${i + 1}. ${p.name}`).join("\n"),
					data: all.map((p) => ({ id: p.id, name: p.name, applied: p.id === device.appliedProfileId })),
				};
			}
			case "apply":
			case "set": {
				if (!arg) return { ok: false, message: "Which profile? Usage: apply <name|number>" };
				return this.apply(findProfile(profiles.all, req.args.join(" ")).id, req);
			}
			case "next":
			case "prev": {
				const current = device.appliedProfileId ?? profiles.active?.id ?? null;
				return this.apply(cycleProfile(profiles.all, current, req.cmd === "next" ? 1 : -1).id, req);
			}
			case "toggle": {
				if (applied()) return this.off(req);
				const id = [lastAppliedId(), profiles.active?.id, profiles.all[0]?.id].find((i) => i && profiles.get(i));
				if (!id) return { ok: false, message: "There are no saved profiles to turn on." };
				return this.apply(id, req);
			}
			case "off":
				return this.off(req);
			case "show":
				this.host.showWindow();
				return { ok: true, message: "Window shown." };
			case "hide":
				this.host.hideWindow();
				return { ok: true, message: "Window hidden." };
			case "toggle-window":
				if (this.host.windowVisible()) this.host.hideWindow();
				else this.host.showWindow();
				return { ok: true, message: this.host.windowVisible() ? "Window shown." : "Window hidden." };
			case "quit":
				setTimeout(() => this.host.quit(), 50); // reply first
				return { ok: true, message: "Quitting NippleTuner." };
			default:
				return { ok: false, message: `Unknown command "${req.cmd}". Try: help` };
		}
	}

	private apply(id: string, req: Request): Response {
		const { profiles, device } = this.host;
		const p = profiles.get(id)!;
		device.apply(id);
		if (device.appliedProfileId !== id) {
			return { ok: false, message: `Couldn't apply "${p.name}" (is the TrackPoint available?).` };
		}
		if (req.notify !== false) this.host.notify("NippleTuner", `Applied profile: ${p.name}`);
		return { ok: true, message: `Applied "${p.name}".` };
	}

	private off(req: Request): Response {
		this.host.device.apply(null);
		if (req.notify !== false) this.host.notify("NippleTuner", "Turned off — TrackPoint back to normal");
		return { ok: true, message: "Turned off (TrackPoint back to normal)." };
	}
}
