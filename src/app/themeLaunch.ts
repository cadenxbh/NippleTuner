import { execFileSync, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ThemeMode } from "../settings/AppSettings";
import { exitProcess } from "../util/exit";

/*
 * Theme helpers. The native Qt look comes from Qt's GTK3 platform theme;
 * ThemeManager switches it live by changing GTK's theme name. Relaunching
 * (with GTK_THEME) is only the fallback when live switching isn't possible.
 */

const MARK = "NIPPLETUNER_THEME"; // set on relaunch, so we don't loop

function themeDirs(): string[] {
	return ["/usr/share/themes", path.join(os.homedir(), ".themes"), path.join(os.homedir(), ".local/share/themes")];
}

function themeExists(name: string): boolean {
	return themeDirs().some((d) => fs.existsSync(path.join(d, name, "gtk-3.0")));
}

/** The desktop's GTK theme name (Cinnamon / GNOME / MATE settings). */
export function systemGtkTheme(): string {
	for (const schema of ["org.cinnamon.desktop.interface", "org.gnome.desktop.interface", "org.mate.interface"]) {
		try {
			const v = execFileSync("gsettings", ["get", schema, "gtk-theme"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
				.trim()
				.replace(/^'|'$/g, "");
			if (v) return v;
		} catch { /* schema not installed */ }
	}
	return "Adwaita";
}

/** Light or dark variant of the current GTK theme (e.g. Mint-L-Dark-Red ↔ Mint-L-Red). */
export function gtkThemeFor(mode: "light" | "dark", current = systemGtkTheme()): string {
	const base = current.replace(/-Dark(er)?(?=-|$)/i, "").replace(/[-:]dark$/i, "");
	const candidates =
		mode === "light"
			? [base]
			: [
				/-Dark(er)?(-|$)/i.test(current) ? current : "",
				base.replace(/^(Mint-[A-Z])(-|$)/, "$1-Dark$2"),
				`${base}-Dark`,
				`${base}-dark`,
			];
	for (const c of candidates) if (c && themeExists(c)) return c;
	return mode === "light" ? "Adwaita" : "Adwaita-dark";
}

/**
 * Older versions forced Light/Dark by relaunching with GTK_THEME set, which
 * also blocks live theme switching. If this process was started that way,
 * relaunch once without it. Returns true if relaunching.
 */
export function dropLegacyThemeEnvironment(): boolean {
	if (!process.env[MARK]) return false;
	relaunch("auto");
	return true;
}

/** Starts a fresh copy of the app with `mode` applied and exits this one. */
export function relaunch(mode: ThemeMode, extraArgs: string[] = []): void {
	const env = { ...process.env };
	if (mode === "auto") {
		if (env[MARK]) delete env.GTK_THEME; // only undo what we set ourselves
		delete env[MARK];
	} else {
		env.GTK_THEME = gtkThemeFor(mode);
		env[MARK] = mode;
	}
	const args = process.argv.slice(1).filter((a) => !extraArgs.includes(a)).concat(extraArgs);
	spawn(process.execPath, args, { env, detached: true, stdio: "inherit" }).unref();
	exitProcess(0);
}
