import { QAction, QMenu, QSystemTrayIcon, QSystemTrayIconActivationReason } from "@nodegui/nodegui";
import { appIcon } from "../util/appIcon";

export interface TrayProfile {
	id: string;
	name: string;
}

export interface TrayHandlers {
	toggleWindow: () => void;
	applyProfile: (id: string) => void;
	turnOff: () => void;
	quit: () => void;
}

/**
 * System tray icon with a small menu: show/hide window, which profile is
 * applied, apply another profile, turn off, quit.
 * Every Qt object is kept referenced for the app's lifetime (see AppMenu.ts
 * for why that matters with nodegui).
 */
export default class Tray {
	readonly icon: QSystemTrayIcon;
	private menu: QMenu;
	private profilesMenu: QMenu;
	private toggleAction: QAction;
	private statusAction: QAction;
	private turnOffAction: QAction;
	private profileActions: QAction[] = [];
	private keepAlive: object[] = [];
	private h: TrayHandlers;

	constructor(handlers: TrayHandlers) {
		this.h = handlers;
		this.icon = new QSystemTrayIcon();
		this.icon.setIcon(appIcon());

		this.menu = new QMenu();
		this.profilesMenu = new QMenu();
		this.profilesMenu.setTitle("Apply Profile");

		this.toggleAction = this.action("Show Window", () => this.h.toggleWindow());
		this.statusAction = this.action("No profile applied");
		this.statusAction.setEnabled(false);
		const profilesHolder = this.action("Apply Profile");
		profilesHolder.setMenu(this.profilesMenu);
		this.turnOffAction = this.action("Turn Off", () => this.h.turnOff());
		const quit = this.action("Quit", () => this.h.quit());

		for (const a of [this.toggleAction, this.separator(), this.statusAction, profilesHolder, this.turnOffAction, this.separator(), quit]) {
			this.menu.addAction(a);
		}
		this.icon.setContextMenu(this.menu);

		this.icon.addEventListener("activated", (reason) => {
			if (reason === QSystemTrayIconActivationReason.Trigger) this.h.toggleWindow();
		});

		this.icon.show();
	}

	/** Short desktop notification from the tray icon (e.g. after a hotkey). */
	notify(title: string, message: string): void {
		this.icon.showMessage(title, message, appIcon(), 2000);
	}

	/** Updates the "Show/Hide Window" label. */
	setWindowVisible(visible: boolean): void {
		this.toggleAction.setText(visible ? "Hide Window" : "Show Window");
	}

	/** Refreshes the profile list and the applied-profile status. */
	setProfiles(profiles: TrayProfile[], appliedId: string | null, testing: boolean): void {
		for (const a of this.profileActions) this.profilesMenu.removeAction(a);
		this.profileActions = profiles.map((p) => {
			const a = this.action(p.name, () => this.h.applyProfile(p.id));
			a.setCheckable(true);
			a.setChecked(p.id === appliedId);
			return a;
		});
		if (this.profileActions.length === 0) {
			const empty = this.action("(no saved profiles)");
			empty.setEnabled(false);
			this.profileActions = [empty];
		}
		for (const a of this.profileActions) this.profilesMenu.addAction(a);

		const applied = profiles.find((p) => p.id === appliedId);
		const status = testing ? "Testing unsaved settings" : applied ? `Applied: ${applied.name}` : "No profile applied";
		this.statusAction.setText(status);
		this.turnOffAction.setEnabled(!!applied);
		this.icon.setToolTip(`NippleTuner — ${status}`);
	}

	private action(text: string, onTrigger?: () => void): QAction {
		const a = new QAction();
		this.keepAlive.push(a);
		a.setText(text);
		if (onTrigger) {
			a.addEventListener("triggered", () => {
				try {
					onTrigger();
				} catch (err: any) {
					console.error("Tray action failed:", err?.stack ?? err);
				}
			});
		}
		return a;
	}

	private separator(): QAction {
		const a = new QAction();
		this.keepAlive.push(a);
		a.setSeparator(true);
		return a;
	}
}
