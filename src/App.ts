import { QApplication, WidgetEventTypes } from "@nodegui/nodegui";
import CurveLibrary from "./curves/CurveLibrary";
import Tray from "./menus/Tray";
import { PointerDevice } from "./pointer";
import ProfileStore from "./profiles/ProfileStore";
import AppSettings from "./settings/AppSettings";
import MainWindow from "./windows/MainWindow";
import { ask, showError } from "./windows/dialogs";
import BackgroundService from "./service/BackgroundService";
import { paletteKey } from "./util/theme";
import { ensurePermissions } from "./app/Permissions";
import { relaunch } from "./app/themeLaunch";
import { resolveDevice } from "./settings/deviceChoice";
import ThemeManager from "./app/ThemeManager";
import Commands from "./app/Commands";
import { serve } from "./service/ipc";
import { rememberApplied } from "./service/profileOps";
import CurveManager from "./app/CurveManager";
import CurveView from "./app/CurveView";
import DeviceController from "./app/DeviceController";
import ImportExport from "./app/ImportExport";
import LiveView from "./app/LiveView";
import Preferences from "./app/Preferences";
import ProfileManager from "./app/ProfileManager";
import StickRange from "./app/StickRange";
import TuningPanel from "./app/TuningPanel";
import { buildTuning, Tuning } from "./app/tuning";

/**
 * Composition root: creates the window, device, data stores and the
 * controllers in app/, wires them together, and runs startup.
 *
 *   TuningPanel     sliders / X-Y toggle / curve dropdown  <->  ProfileSettings
 *   CurveView       draws the current tuning on the graph + preview
 *   LiveView        live input + tuned-output dots
 *   DeviceController what the real pointer runs (test / applied profile / off)
 *   CurveManager    curve library, Curves menu, curve editor windows
 *   ProfileManager  Profiles menu, startup profile, Save & Apply
 *   Preferences     Preferences menu (startup, theme, background service…)
 *   ImportExport    File menu import/export
 *   BackgroundService  optional systemd user service that keeps the applied
 *                      profile running while the app is closed
 */
export default class App {
	readonly win: MainWindow;
	readonly theme = new ThemeManager();
	readonly library = new CurveLibrary();
	readonly profiles = new ProfileStore();
	readonly settings = new AppSettings();
	readonly range: StickRange;
	readonly panel: TuningPanel;
	readonly view: CurveView;
	readonly device: DeviceController;
	readonly curves: CurveManager;
	readonly profileManager: ProfileManager;
	readonly preferences: Preferences;
	readonly importExport: ImportExport;
	readonly tray: Tray;
	readonly live: LiveView;
	readonly service = new BackgroundService();

	/** The tuning currently drawn in the window. */
	private shown: Tuning | null = null;
	/** Closes the CLI socket (see service/ipc.ts). */
	private closeCli: (() => void) | null = null;

	constructor() {
		// Closing the window hides it to the tray; the app keeps running.
		QApplication.instance().setQuitOnLastWindowClosed(false);

		const win = (this.win = new MainWindow());
		const menu = win.menu;

		// (Permissions were checked in main.ts before the app was created.)
		// Mark this as the running instance: it owns the TrackPoint (the
		// background service steps aside) and later launches hand over to it
		// (they send SIGUSR2; handled before claiming so it can never kill us).
		process.on("SIGUSR2", () => this.showWindow());
		this.service.claimDevice();
		const tp = this.openDevice();
		this.range = new StickRange(tp);
		this.panel = new TuningPanel(win, this.range);
		this.view = new CurveView(win.getGraph(), win.getPreview());

		this.device = new DeviceController(
			tp,
			{
				editing: () => this.panel.settings,
				profile: (id) => this.profiles.get(id),
				tune: (s) => buildTuning(s, this.library, this.range.maxSpeed),
			},
			(title, message) => showError(win, title, message),
		);

		this.curves = new CurveManager(win, menu, this.library, this.panel);
		this.profileManager = new ProfileManager(win, menu, this.profiles, this.settings, this.panel, this.device);
		this.preferences = new Preferences(win, menu, this.settings, this.panel, this.service, {
			graphsModeChanged: () => this.updateFocusState(),
			backgroundServiceChanged: () => {
				this.service.claimDevice();
				this.updateServiceConfig();
			},
			restart: () => this.restart(),
			switchDevice: () => this.switchDevice(),
			applyTheme: () => this.theme.apply(this.settings.theme),
			checkPermissions: () => this.checkPermissionsNow(),
		});
		this.importExport = new ImportExport(win, menu, this.library, this.profiles, this.panel, this.curves, this.profileManager, () => this.currentTuning());

		this.tray = new Tray({
			toggleWindow: () => (win.isVisible() ? win.hide() : this.showWindow()),
			applyProfile: (id) => this.device.apply(id),
			turnOff: () => this.device.apply(null),
			quit: () => this.quit(),
		});

		this.live = new LiveView(tp, this.range, win.getPreview(), win.getGraph(), () => ({
			tuning: this.shown ?? this.currentTuning(),
			displayMax: this.view.displayMax,
		}));

		// --- wiring ---------------------------------------------------------
		this.panel.onChange(() => this.render());
		this.range.onChange(() => this.render());
		this.device.onChange(() => {
			this.updateStatus();
			this.updateServiceConfig();
			rememberApplied(this.device.appliedProfileId); // for `nippletuner toggle`
		});
		this.profiles.onChange(() => this.updateStatus());
		menu.on("file.quit", () => this.quit());

		win.testButton.setEnabled(this.device.available);
		win.testButton.addEventListener("clicked", () => this.device.setTesting(!this.device.testing));
		win.saveApplyButton.addEventListener("clicked", () => this.profileManager.saveAndApply());

		win.addEventListener(WidgetEventTypes.Show, () => this.tray.setWindowVisible(true));
		win.addEventListener(WidgetEventTypes.Hide, () => {
			this.tray.setWindowVisible(false);
			// A test only lasts while the window is open; fall back to the applied profile.
			if (this.device.testing) this.device.setTesting(false);
		});
	}

	/** Loads state, applies the startup profile and shows (or hides) the window. */
	start(): void {
		this.curves.refreshLists();
		this.profileManager.refresh();
		if (this.profiles.active) this.panel.setSettings(this.profiles.active);
		else this.render();

		// Profile to run: the startup profile, else whatever the background
		// service was running (so opening the app doesn't change anything).
		const serviceProfile = this.service.installed ? this.service.config?.profileId : undefined;
		const startupId = [this.settings.startupProfileId, serviceProfile].find((id) => id && this.profiles.get(id));
		if (startupId) this.profileManager.load(startupId);
		// If the service still holds the TrackPoint, wait until it lets go.
		this.service.whenDeviceFree(() => {
			if (startupId) this.device.apply(startupId);
			else this.device.sync();
		});

		// Theme (live: no restart needed).
		this.theme.apply(this.settings.theme);

		// `--show` forces the window open (handy when running from a terminal).
		if (this.settings.showGuiOnStartup || process.argv.includes("--show")) {
			this.showWindow();
		} else {
			// qode only starts running Node's event loop (timers, device reads)
			// once a window has been shown. Showing and hiding in the same tick
			// starts it without anything appearing on screen.
			this.win.show();
			this.win.hide();
		}

		this.live.start();

		// Command-line control (`nippletuner next`, `apply …`, …; see src/cli.ts).
		const commands = new Commands({
			profiles: this.profiles,
			device: this.device,
			deviceName: () => this.tp?.name ?? null,
			showWindow: () => this.showWindow(),
			hideWindow: () => this.win.hide(),
			windowVisible: () => this.win.isVisible(),
			quit: () => this.quit(),
			notify: (title, message) => this.tray.notify(title, message),
		});
		this.closeCli = serve((req) => commands.handle(req));
		// Focus (paused graphs) and system theme changes.
		let lastPalette = paletteKey();
		setInterval(() => {
			this.updateFocusState();
			const key = paletteKey();
			if (key !== lastPalette) {
				lastPalette = key;
				this.render(); // accent colours follow light/dark
			}
		}, 250);
		process.on("exit", () => {
			this.device.stop();
			this.service.releaseDevice();
		});
	}

	/** The pointer device in use (null if none could be opened). */
	get tp(): PointerDevice | null {
		return this.device.tp;
	}

	/**
	 * Switches to the device chosen in Preferences → Device without
	 * restarting: the old device is released, the new one opened, and an
	 * applied profile (or running test) continues on it.
	 */
	switchDevice(): boolean {
		this.device.setDevice(null); // releases the old device first (grab + reading)
		const tp = this.openDevice();
		this.range.setDevice(tp); // re-scales sliders/graphs for the new device
		this.live.setDevice(tp);
		this.device.setDevice(tp); // re-applies whatever was running
		this.win.testButton.setEnabled(!!tp);
		this.render();
		this.updateStatus();
		if (!tp) {
			showError(this.win, "NippleTuner", "Couldn't open that device.", "Check Preferences → Check Permissions…, or pick another device.");
		}
		return !!tp;
	}

	/** Builds the tuning for the window's current settings. */
	currentTuning(): Tuning {
		return buildTuning(this.panel.settings, this.library, this.range.maxSpeed);
	}

	showWindow(): void {
		this.win.show();
		this.win.raise();
		this.win.activateWindow();
	}

	quit(): void {
		this.shutdown();
		QApplication.instance().quit();
		// Qt's loop stops, but Node would keep running (device reader, timers)
		// as an invisible process; end it for real.
		process.exit(0);
	}

	/** Releases the TrackPoint and hands it back to the background service. */
	private shutdown(): void {
		this.closeCli?.();
		this.live.stop();
		this.device.stop();
		this.service.releaseDevice();
	}

	/** Restarts the app, reopening the window (only a fallback now). */
	private restart(): void {
		this.shutdown();
		// "auto" = no GTK_THEME override; the saved theme is applied live on startup.
		relaunch("auto", ["--show"]);
	}

	/** Preferences → Check Permissions… */
	private async checkPermissionsNow(): Promise<void> {
		const s = await ensurePermissions(this.win);
		if (!s.devnode) {
			showError(this.win, "NippleTuner", "No TrackPoint was found.", "NippleTuner looks for a pointing stick (TrackPoint). None is connected right now.");
		} else if (s.canRead && s.canWriteUinput) {
			if (this.tp) {
				showError(this.win, "NippleTuner", "Everything's set up.", "NippleTuner has all the access it needs.");
			} else if (await ask(this.win, {
				title: "NippleTuner",
				text: "Access is working now. Restart NippleTuner to start using your TrackPoint?",
				ok: "Restart Now",
				cancel: "Later",
			})) {
				this.restart();
			}
		}
	}

	/**
	 * Pauses and greys out the live graphs when the window isn't focused
	 * (Preferences → Update Graphs on Focus Only), and whenever it's hidden.
	 */
	private updateFocusState(): void {
		const visible = this.win.isVisible();
		const focused = visible && (this.win.isActiveWindow() || this.curves.editorFocused);
		const dim = this.settings.graphsOnFocusOnly && visible && !focused;
		this.live.setPaused(!visible || dim);
		const message = dim ? "Paused while the window isn't focused\nClick here to resume" : null;
		this.win.getGraph().setDimmed(message);
		this.win.getPreview().setDimmed(message);
	}

	/** Tells the background service what to run once this window closes. */
	private updateServiceConfig(): void {
		if (!this.service.installed) return;
		const id = this.device.appliedProfileId;
		const profile = id ? this.profiles.get(id) : undefined;
		if (!profile) {
			this.service.setConfig(null);
			return;
		}
		const t = buildTuning(profile, this.library, this.range.maxSpeed);
		this.service.setConfig({ profileId: profile.id, profileName: profile.name, curve: t.curve.toJSON(), sens: t.sens });
	}

	/** Redraws the curve and, while testing, pushes it to the pointer. */
	private render(): void {
		this.shown = this.currentTuning();
		this.view.render(this.shown, this.panel.independentAxes);
		this.device.sync();
	}

	/** Test button, window title, menu and tray status. */
	private updateStatus(): void {
		const { device, profiles, win } = this;
		const applied = device.appliedProfileId ? profiles.get(device.appliedProfileId) : undefined;
		win.testButton.setText(device.testing ? "■ Stop Test" : "Test");
		const editing = profiles.active?.name;
		const state = device.testing ? "testing" : applied ? `applied: ${applied.name}` : "off";
		win.setWindowTitle(`NippleTuner${editing ? ` — ${editing}` : ""} (${state})`);
		win.menu.setEnabled("profiles.turnOff", !!applied);
		this.tray?.setProfiles(profiles.all.map((p) => ({ id: p.id, name: p.name })), device.appliedProfileId, device.testing);
	}

	/** Opens the device chosen in Preferences → Device (default: the TrackPoint). */
	private openDevice(): PointerDevice | null {
		const { info, missing } = resolveDevice(this.settings.deviceKey);
		if (missing) {
			const name = this.settings.deviceKey?.split("|")[0];
			showError(
				null,
				"NippleTuner",
				`The device you selected ("${name}") isn't connected.`,
				info
					? `Using ${info.name} for now. Pick a different device in Preferences → Device, or reconnect it and restart NippleTuner.`
					: "No TrackPoint was found either. Pick a device in Preferences → Device.",
			);
		}
		if (!info) {
			console.error("No pointer device to use (no TrackPoint found, none selected).");
			return null;
		}
		try {
			const tp = PointerDevice.from(info);
			tp.start();
			console.log(`Reading ${tp.name} (${tp.info.devnode}), sensitivity ${tp.readHardwareSetting("sensitivity") ?? "n/a"}`);
			return tp;
		} catch (err: any) {
			console.error(`${info.name} unavailable: ${err?.message ?? err}`);
			return null;
		}
	}
}
