import { execFileSync, spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import { QWidget } from "@nodegui/nodegui";
import AppSettings from "../settings/AppSettings";
import { resolveDevice } from "../settings/deviceChoice";
import { ask, showError } from "../windows/dialogs";

const UINPUT = "/dev/uinput";
const UDEV_RULE_FILE = "/etc/udev/rules.d/60-nippletuner-uinput.rules";
const UDEV_RULE = 'KERNEL=="uinput", GROUP="input", MODE="0660", OPTIONS+="static_node=uinput"';

/** Everything that decides whether NippleTuner can work, read fresh each time. */
export interface PermissionStatus {
	user: string;
	/** TrackPoint event node, or null if no pointing stick was found. */
	devnode: string | null;
	canRead: boolean;
	canWriteUinput: boolean;
	/** Your account is in the "input" group (what `id -nG` reports now). */
	inGroupAccount: boolean;
	/** This login session already has the "input" group (needs a re-login after joining). */
	inGroupSession: boolean;
}

function accessible(file: string, mode: number): boolean {
	try {
		fs.accessSync(file, mode);
		return true;
	} catch {
		return false;
	}
}

function inputGid(): number | null {
	try {
		const line = fs.readFileSync("/etc/group", "utf8").split("\n").find((l) => l.startsWith("input:"));
		return line ? Number(line.split(":")[2]) : null;
	} catch {
		return null;
	}
}

export function checkPermissions(): PermissionStatus {
	const user = os.userInfo().username;
	const devnode = resolveDevice(new AppSettings().deviceKey).info?.devnode ?? null;
	const gid = inputGid();
	let accountGroups: string[] = [];
	try {
		// `id -nG user` reads the account database, so it already reflects a
		// usermod done in this session (unlike the process's own groups).
		accountGroups = execFileSync("id", ["-nG", user], { encoding: "utf8" }).trim().split(/\s+/);
	} catch { /* ignore */ }
	return {
		user,
		devnode,
		canRead: devnode ? accessible(devnode, fs.constants.R_OK) : true,
		canWriteUinput: accessible(UINPUT, fs.constants.W_OK),
		inGroupAccount: accountGroups.includes("input"),
		inGroupSession: gid !== null && (process.getgroups?.() ?? []).includes(gid),
	};
}

export type PermissionAction =
	| { action: "ok" }
	| { action: "grant"; cmds: string[] } // run commands as root (then maybe log out)
	| { action: "logout" } // in the group, but this session predates it
	| { action: "diagnose" }; // should work but doesn't: show details

/** What to do about a status (pure, so it can be tested). */
export function planPermissions(s: PermissionStatus, udevRulePresent = fs.existsSync(UDEV_RULE_FILE)): PermissionAction {
	if (!s.devnode || (s.canRead && s.canWriteUinput)) return { action: "ok" };
	const cmds = fixCommands(s, udevRulePresent);
	if (cmds.length) return { action: "grant", cmds };
	if (s.inGroupAccount && !s.inGroupSession) return { action: "logout" };
	return { action: "diagnose" };
}

/** Root commands needed to fix what's missing (empty if nothing can be fixed by root). */
function fixCommands(s: PermissionStatus, udevRulePresent: boolean): string[] {
	const cmds: string[] = [];
	if (!s.canRead && !s.inGroupAccount) cmds.push(`usermod -aG input ${s.user}`);
	if (!s.canWriteUinput && !udevRulePresent) {
		cmds.push(`echo '${UDEV_RULE}' > ${UDEV_RULE_FILE}`);
		cmds.push("udevadm control --reload-rules");
		cmds.push("udevadm trigger --name-match=uinput");
	}
	return cmds;
}

/** Runs commands via pkexec without blocking (the app keeps running during the password prompt). */
function runAsRoot(cmds: string[]): Promise<{ ok: boolean; cancelled: boolean; output: string }> {
	return new Promise((resolve) => {
		let output = "";
		const child = spawn("pkexec", ["sh", "-c", ["set -e", ...cmds].join("\n")]);
		child.stdout.on("data", (d) => (output += d));
		child.stderr.on("data", (d) => (output += d));
		child.on("error", (err) => resolve({ ok: false, cancelled: false, output: String(err) }));
		// pkexec: 126 = authorization dismissed/denied, 127 = not authorized / no agent.
		child.on("close", (code) => resolve({ ok: code === 0, cancelled: code === 126 || code === 127, output: output.trim() }));
	});
}

const LOGOUT_COMMANDS: [string, string[]][] = [
	["cinnamon-session-quit", ["--logout"]],
	["gnome-session-quit", ["--logout"]],
	["mate-session-save", ["--logout-dialog"]],
	["xfce4-session-logout", []],
	["qdbus", ["org.kde.ksmserver", "/KSMServer", "logout", "1", "0", "0"]],
];

/** Opens the desktop's own log-out dialog. Returns false if none was found. */
function requestLogout(): boolean {
	for (const [cmd, args] of LOGOUT_COMMANDS) {
		if (spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0) {
			spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
			return true;
		}
	}
	return false;
}

async function promptLogout(parent: QWidget | null, s: PermissionStatus, justAdded: boolean): Promise<void> {
	const logout = await ask(parent, {
		title: "NippleTuner — log out to finish",
		text: justAdded
			? "Access granted. One more step: log out and back in."
			: "Almost done: log out and back in so NippleTuner can use your TrackPoint.",
		informative:
			`Your account (${s.user}) is in the "input" group, but this login session started before that ` +
			`change, so it doesn't have the new access yet. Linux only applies group changes when you log in.\n\n` +
			`After you log back in, NippleTuner will work normally. Until then it can open and edit settings, ` +
			`but it can't read or tune the TrackPoint.`,
		ok: "Log Out Now…",
		cancel: "Later",
	});
	if (logout && !requestLogout()) {
		await showError(parent, "NippleTuner", "Couldn't open your desktop's log-out dialog.", "Please log out from your desktop menu, then log back in.");
	}
}

/**
 * Startup check with clear prompts:
 *  - not in the "input" group           → offer to add you (asks for your password), then ask to log out
 *  - in the group, session doesn't have it → ask to log out and back in
 *  - /dev/uinput not writable           → offer to install a udev rule (asks for your password)
 * Returns the status after any fixes (most fixes only take effect after re-login).
 */
export async function ensurePermissions(parent: QWidget | null): Promise<PermissionStatus> {
	let s = checkPermissions();
	const plan = planPermissions(s);
	if (plan.action === "ok") return s; // all good, or no TrackPoint at all

	if (plan.action === "grant") {
		const cmds = plan.cmds;
		const needGroup = cmds.some((c) => c.startsWith("usermod"));
		const reasons: string[] = [];
		if (needGroup) reasons.push(`• read your TrackPoint (${s.devnode}) — your account needs to be in the "input" group, and it isn't yet`);
		if (!s.canWriteUinput) reasons.push(`• create a virtual pointer to apply curves (${UINPUT} isn't writable)`);
		const go = await ask(parent, {
			title: "NippleTuner — permission needed",
			text: "NippleTuner needs permission to access your TrackPoint.",
			informative:
				`It needs to:\n${reasons.join("\n")}\n\n` +
				`If you continue, your system will ask for your password and run the command(s) below as root. ` +
				`Nothing else is changed.` +
				(needGroup ? `\n\nAfterwards you'll need to log out and back in once.` : ""),
			details: cmds.join("\n"),
			ok: "Grant Access…",
			cancel: "Not Now",
		});
		if (!go) return s;

		const r = await runAsRoot(cmds);
		if (!r.ok) {
			if (r.cancelled) {
				await showError(parent, "NippleTuner", "No changes were made.", "The password prompt was cancelled. You can grant access next time NippleTuner starts.");
			} else {
				await showError(parent, "NippleTuner", "Granting access failed.", "The command didn't succeed. Details below.", `${cmds.join("\n")}\n\n${r.output}`);
			}
			return checkPermissions();
		}
		s = checkPermissions();
		if (s.canRead && s.canWriteUinput) return s; // e.g. only the udev rule was needed
		if (!s.inGroupSession) await promptLogout(parent, s, true);
		return s;
	}

	// Nothing root can fix: the group change is done but this session predates it.
	if (plan.action === "logout") {
		await promptLogout(parent, s, false);
		return s;
	}

	// Has the group in this session and still can't access: report exactly what we see.
	await showError(
		parent,
		"NippleTuner — can't access the TrackPoint",
		"NippleTuner still can't access your TrackPoint, even though permissions look correct.",
		"Your session is in the \"input\" group, so this is unusual. A reboot usually fixes it. Details below.",
		[
			`Device: ${s.devnode}`,
			`Readable: ${s.canRead}`,
			`${UINPUT} writable: ${s.canWriteUinput}`,
			`Account in input group: ${s.inGroupAccount}`,
			`Session has input group: ${s.inGroupSession}`,
			`udev rule present: ${fs.existsSync(UDEV_RULE_FILE)}`,
		].join("\n"),
	);
	return s;
}
