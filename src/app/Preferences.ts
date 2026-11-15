import AppMenu from "../menus/AppMenu";
import AppSettings, { ThemeMode } from "../settings/AppSettings";
import BackgroundService, { REVERT_COMMAND } from "../service/BackgroundService";
import MainWindow from "../windows/MainWindow";
import { ask, showError } from "../windows/dialogs";
import TuningPanel from "./TuningPanel";
import { listPointerDevices } from "../pointer";
import { deviceKey, deviceLabel } from "../settings/deviceChoice";

const AUTO_DEVICE = "__auto__";

export interface PreferenceHooks {
	/** "Update Graphs on Focus Only" changed. */
	graphsModeChanged: () => void;
	/** The service was installed/removed (App re-sends the applied profile). */
	backgroundServiceChanged: () => void;
	/** Relaunch the app (settings already saved); only a fallback now. */
	restart: () => void;
	/** Switch to the device in settings right away. Returns false if it couldn't be opened. */
	switchDevice: () => boolean;
	/** Apply the theme in settings right away. Returns false if a restart is needed. */
	applyTheme: () => boolean;
	/** Preferences → Check Permissions… */
	checkPermissions: () => void;
}

const THEMES: { id: ThemeMode; label: string }[] = [
	{ id: "auto", label: "Match System" },
	{ id: "light", label: "Light" },
	{ id: "dark", label: "Dark" },
];

/** Preferences menu. */
export default class Preferences {
	constructor(
		private win: MainWindow,
		private menu: AppMenu,
		private settings: AppSettings,
		panel: TuningPanel,
		private service: BackgroundService,
		private hooks: PreferenceHooks,
	) {
		// Independent X/Y: the menu item and the window's checkbox stay in sync.
		menu.on("prefs.independentAxes", (on) => panel.setIndependent(on));
		panel.onAxesModeChanged((on) => menu.setChecked("prefs.independentAxes", on));

		menu.setChecked("prefs.loadOnStartup", settings.loadOnStartup);
		menu.on("prefs.loadOnStartup", (on) => {
			try {
				settings.setLoadOnStartup(on);
			} catch (err: any) {
				menu.setChecked("prefs.loadOnStartup", settings.loadOnStartup);
				showError(win, "Load on Startup", err?.message ?? String(err));
			}
		});

		menu.setChecked("prefs.showGuiOnStartup", settings.showGuiOnStartup);
		menu.on("prefs.showGuiOnStartup", (on) => settings.setShowGuiOnStartup(on));

		menu.setChecked("prefs.backgroundService", service.installed);
		menu.on("prefs.backgroundService", (on) => (on ? this.installService() : this.removeService()));

		menu.setChecked("prefs.graphsOnFocusOnly", settings.graphsOnFocusOnly);
		menu.on("prefs.graphsOnFocusOnly", (on) => {
			settings.setGraphsOnFocusOnly(on);
			hooks.graphsModeChanged();
		});

		menu.setChoices("theme", THEMES.map((t) => ({ id: t.id, label: t.label })), settings.theme, (id) => this.changeTheme(id as ThemeMode), "theme");

		menu.on("prefs.checkPermissions", () => hooks.checkPermissions());

		// Device: refreshed every time the submenu opens (devices come and go).
		this.refreshDevices();
		menu.onMenuShow("device", () => this.refreshDevices());
	}

	private refreshDevices(): void {
		const saved = this.settings.deviceKey;
		const devices = listPointerDevices();
		const items = [
			{ id: AUTO_DEVICE, label: "Automatic (first TrackPoint)" },
			...devices.map((d) => ({ id: deviceKey(d), label: deviceLabel(d) })),
		];
		// Keep a saved-but-unplugged device visible so it's clear what's selected.
		if (saved && !items.some((i) => i.id === saved)) items.push({ id: saved, label: `${saved.split("|")[0]} (not connected)` });
		this.menu.setChoices("device", items, saved ?? AUTO_DEVICE, (id) => this.changeDevice(id === AUTO_DEVICE ? null : id), "device");
	}

	/** Saves the choice and switches immediately (an applied profile carries over). */
	private changeDevice(key: string | null): void {
		if (key === this.settings.deviceKey) return;
		this.settings.setDeviceKey(key);
		this.hooks.switchDevice();
		this.refreshDevices();
	}

	private async installService(): Promise<void> {
		const go = await ask(this.win, {
			title: "NippleTuner — keep running when closed",
			text: "Keep your applied profile working after you close NippleTuner?",
			informative:
				"NippleTuner will set up a small background service for your user account. It applies your " +
				"applied profile (the one from Save & Apply or the tray) whenever no NippleTuner window is " +
				"running — including right after you log in.\n\n" +
				"• No password needed; nothing system-wide is changed.\n" +
				"• To undo it, uncheck this option. The TrackPoint goes back to normal as soon as the service stops.\n" +
				"• If the TrackPoint ever becomes hard to use, use the touchpad to uncheck this, or run the command under " +
				"\"Show Details\" in a terminal.",
			details: `Undo from a terminal:\n${REVERT_COMMAND}`,
			ok: "Turn On",
		});
		if (!go) {
			this.menu.setChecked("prefs.backgroundService", false);
			return;
		}
		try {
			this.service.install();
		} catch (err: any) {
			this.service.uninstall();
			showError(this.win, "NippleTuner", "Couldn't set up the background service.", err?.message ?? String(err));
		}
		this.menu.setChecked("prefs.backgroundService", this.service.installed);
		this.hooks.backgroundServiceChanged();
	}

	private removeService(): void {
		this.service.uninstall();
		this.menu.setChecked("prefs.backgroundService", this.service.installed);
		this.hooks.backgroundServiceChanged();
	}

	/** Saves and applies the theme live; asks for a restart only if live switching isn't possible. */
	private async changeTheme(mode: ThemeMode): Promise<void> {
		if (mode === this.settings.theme) return;
		this.settings.setTheme(mode);
		if (this.hooks.applyTheme()) return;
		const now = await ask(this.win, {
			title: "NippleTuner — theme",
			text: "Restart NippleTuner to change the theme?",
			informative:
				"The theme can't be switched live in this session (a GTK_THEME environment variable is set, or Qt " +
				"isn't using its GTK theme). It's saved and will apply after a restart.",
			ok: "Restart Now",
			cancel: "Later",
		});
		if (now) this.hooks.restart();
	}
}
