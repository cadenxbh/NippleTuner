import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readJSON, writeJSON } from "../util/storage";

export interface AppSettingsData {
	/** Launch NippleTuner (in the tray) when you log in. */
	loadOnStartup: boolean;
	/** Profile applied automatically when the app starts (null = none). */
	startupProfileId: string | null;
	/** Open the main window when the app starts (otherwise only the tray icon). */
	showGuiOnStartup: boolean;
	/** Pause and grey out the live graphs while the window isn't focused. */
	graphsOnFocusOnly: boolean;
	/** "auto" follows the system; "light"/"dark" force a variant. */
	theme: ThemeMode;
	/** Chosen pointer device (see settings/deviceChoice.ts); null = automatic (TrackPoint). */
	deviceKey: string | null;
}

export type ThemeMode = "auto" | "light" | "dark";

const FILE = "settings.json";
const DEFAULTS: AppSettingsData = {
	loadOnStartup: false,
	startupProfileId: null,
	showGuiOnStartup: false,
	graphsOnFocusOnly: true,
	theme: "auto",
	deviceKey: null,
};

const AUTOSTART_FILE = path.join(
	process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
	"autostart",
	"nippletuner.desktop",
);

export default class AppSettings {
	private data: AppSettingsData;

	constructor() {
		this.data = { ...DEFAULTS, ...readJSON<Partial<AppSettingsData>>(FILE, {}) };
		// The autostart file is the source of truth for "load on startup".
		this.data.loadOnStartup = fs.existsSync(AUTOSTART_FILE);
	}

	get loadOnStartup(): boolean {
		return this.data.loadOnStartup;
	}

	get startupProfileId(): string | null {
		return this.data.startupProfileId;
	}

	get showGuiOnStartup(): boolean {
		return this.data.showGuiOnStartup;
	}

	get graphsOnFocusOnly(): boolean {
		return this.data.graphsOnFocusOnly;
	}

	get theme(): ThemeMode {
		return ["auto", "light", "dark"].includes(this.data.theme) ? this.data.theme : "auto";
	}

	get deviceKey(): string | null {
		return typeof this.data.deviceKey === "string" ? this.data.deviceKey : null;
	}

	setDeviceKey(key: string | null): void {
		this.data.deviceKey = key;
		this.save();
	}

	setGraphsOnFocusOnly(on: boolean): void {
		this.data.graphsOnFocusOnly = on;
		this.save();
	}

	setTheme(mode: ThemeMode): void {
		this.data.theme = mode;
		this.save();
	}

	setStartupProfile(id: string | null): void {
		this.data.startupProfileId = id;
		this.save();
	}

	setShowGuiOnStartup(on: boolean): void {
		this.data.showGuiOnStartup = on;
		this.save();
	}

	/**
	 * Adds/removes an XDG autostart entry that launches this exact runtime
	 * and script (works on Cinnamon, GNOME, KDE, XFCE…).
	 */
	setLoadOnStartup(on: boolean): void {
		if (on) {
			// __filename is the bundle itself (dist/main.cjs), whatever launched it.
			const script = path.resolve(__filename);
			const projectDir = path.dirname(path.dirname(script));
			const quote = (s: string) => `"${s.replace(/(["\\`$])/g, "\\$1")}"`;
			fs.mkdirSync(path.dirname(AUTOSTART_FILE), { recursive: true });
			fs.writeFileSync(AUTOSTART_FILE, [
				"[Desktop Entry]",
				"Type=Application",
				"Name=NippleTuner",
				"Comment=TrackPoint acceleration tuner",
				`Exec=${quote(process.execPath)} ${quote(script)}`,
				`Path=${projectDir}`,
				`Icon=${path.join(projectDir, "assets", "icons", "nippletuner-256.png")}`,
				"Terminal=false",
				"X-GNOME-Autostart-enabled=true",
				"",
			].join("\n"));
		} else if (fs.existsSync(AUTOSTART_FILE)) {
			fs.unlinkSync(AUTOSTART_FILE);
		}
		this.data.loadOnStartup = on;
		this.save();
	}

	private save(): void {
		writeJSON(FILE, this.data);
	}
}
