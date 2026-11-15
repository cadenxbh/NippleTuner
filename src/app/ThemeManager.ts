import { execFile } from "child_process";
import * as koffi from "koffi";
import { ThemeMode } from "../settings/AppSettings";
import { gtkThemeFor, systemGtkTheme } from "./themeLaunch";

const FOLLOW_MS = 3000;

/**
 * Switches the theme live, without restarting.
 *
 * Qt's GTK3 platform theme (which gives the app its native look) watches
 * GTK's "gtk-theme-name" setting and re-reads the palette when it changes,
 * so setting it from inside the app switches every window in ~100 ms.
 * GTK's own code never sees desktop theme changes here (no GTK main loop),
 * so in "Match System" mode the desktop setting is polled and passed on.
 */
export default class ThemeManager {
	private settingsPtr: unknown = null;
	private setProp: ((...args: unknown[]) => void) | null = null;
	private getProp: ((...args: unknown[]) => void) | null = null;
	private mode: ThemeMode = "auto";
	private applied = "";
	private timer: NodeJS.Timeout | null = null;

	constructor() {
		// A GTK_THEME environment variable overrides gtk-theme-name entirely.
		if (process.env.GTK_THEME) return;
		try {
			const gtk = koffi.load("libgtk-3.so.0");
			const gobject = koffi.load("libgobject-2.0.so.0");
			const getDefault = gtk.func("void *gtk_settings_get_default(void)");
			// Only non-null if Qt's GTK3 platform theme initialised GTK (i.e. is in use).
			this.settingsPtr = getDefault();
			this.setProp = gobject.func("void g_object_set(void *object, const char *name, ...)") as any;
			this.getProp = gobject.func("void g_object_get(void *object, const char *name, _Out_ const char **value, void *end)") as any;
		} catch {
			this.settingsPtr = null;
		}
	}

	/** Live switching works in this session (otherwise a restart is needed). */
	get live(): boolean {
		return !!this.settingsPtr && !!this.setProp;
	}

	/** Applies `mode` now and, for "auto", keeps following the desktop. */
	apply(mode: ThemeMode): boolean {
		this.mode = mode;
		if (!this.live) return false;
		this.setTheme(mode === "auto" ? systemGtkTheme() : gtkThemeFor(mode));
		if (!this.timer) this.timer = setInterval(() => this.follow(), FOLLOW_MS);
		return true;
	}

	/** GTK's current theme name. */
	private current(): string {
		const out: (string | null)[] = [null];
		this.getProp!(this.settingsPtr, "gtk-theme-name", out, null);
		return out[0] ?? "";
	}

	private setTheme(name: string): void {
		if (name === this.applied) return;
		this.applied = name;
		// Re-setting the value GTK already has makes Qt's GTK theme fall back
		// to a plain grey palette, so only set real changes.
		if (name === this.current()) return;
		this.setProp!(this.settingsPtr, "gtk-theme-name", "str", name, "void *", null);
	}

	/** Re-reads the desktop theme (async) and follows changes. */
	private follow(): void {
		execFile("gsettings", ["get", "org.cinnamon.desktop.interface", "gtk-theme"], (err, out) => {
			const desktop = err ? systemGtkTheme() : out.trim().replace(/^'|'$/g, "");
			if (!desktop) return;
			// Light/Dark follow the desktop's theme family too (e.g. a new accent colour).
			this.setTheme(this.mode === "auto" ? desktop : gtkThemeFor(this.mode, desktop));
		});
	}
}
