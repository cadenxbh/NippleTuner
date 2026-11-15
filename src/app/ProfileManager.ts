import AppMenu from "../menus/AppMenu";
import ProfileStore from "../profiles/ProfileStore";
import AppSettings from "../settings/AppSettings";
import MainWindow from "../windows/MainWindow";
import { askText, confirm, showError } from "../windows/dialogs";
import { uniqueName } from "../util/storage";
import DeviceController from "./DeviceController";
import TuningPanel from "./TuningPanel";

const NO_STARTUP_PROFILE = "__none__";

/**
 * Profiles: the Profiles menu (new/save/rename/delete/load/turn off), the
 * Preferences → Startup Profile list, and Save & Apply.
 */
export default class ProfileManager {
	constructor(
		private win: MainWindow,
		private menu: AppMenu,
		private profiles: ProfileStore,
		private settings: AppSettings,
		private panel: TuningPanel,
		private device: DeviceController,
	) {
		profiles.onChange(() => this.refresh());

		menu.on("profiles.new", async () => {
			const name = await askText(win, "New Profile", "Profile name (saves the current settings):", uniqueName("New profile", profiles.names()));
			if (name) profiles.create(name, panel.settings);
		});
		menu.on("profiles.save", () => {
			const active = profiles.active;
			if (active) profiles.overwrite(active.id, panel.settings);
			else this.saveAs();
		});
		menu.on("profiles.saveAs", () => this.saveAs());
		menu.on("profiles.rename", async () => {
			const active = profiles.active;
			if (!active) return;
			const name = await askText(win, "Rename Profile", "New name:", active.name);
			if (name) profiles.rename(active.id, name);
		});
		menu.on("profiles.delete", async () => {
			const active = profiles.active;
			if (active && await confirm(win, "Delete Profile", `Delete the profile "${active.name}"?`, "Delete")) {
				profiles.remove(active.id);
			}
		});
		menu.on("profiles.turnOff", () => device.apply(null));
	}

	/** Loads a profile into the editor (doesn't apply it). */
	load(id: string): void {
		const p = this.profiles.get(id);
		if (!p) return;
		this.profiles.setActive(id);
		this.panel.setSettings(p);
	}

	/** Prompts for a name, saves the current settings under it and applies it. */
	async saveAndApply(): Promise<void> {
		const { profiles } = this;
		const suggested = profiles.active?.name ?? uniqueName("My profile", profiles.names());
		const name = await askText(this.win, "Save & Apply", "Profile name (an existing name is overwritten):", suggested);
		if (!name) return;
		const existing = profiles.all.find((p) => p.name === name);
		let id: string;
		if (existing) {
			profiles.overwrite(existing.id, this.panel.settings);
			profiles.setActive(existing.id);
			id = existing.id;
		} else {
			id = profiles.create(name, this.panel.settings).id;
		}
		if (!this.device.available) showError(this.win, "Save & Apply", "Saved, but no TrackPoint is available to apply it to.");
		this.device.apply(id);
	}

	/** Rebuilds the profile lists in the menus. */
	refresh(): void {
		const { profiles, settings, menu } = this;
		const active = profiles.active;
		// Drop a startup profile that no longer exists.
		if (settings.startupProfileId && !profiles.get(settings.startupProfileId)) settings.setStartupProfile(null);

		menu.setChoices("profiles", profiles.all.map((p) => ({ id: p.id, label: p.name })), active?.id ?? null, (id) => this.load(id));
		for (const a of ["profiles.rename", "profiles.delete"]) menu.setEnabled(a, !!active);

		menu.setChoices(
			"startup-profile",
			[{ id: NO_STARTUP_PROFILE, label: "None" }, ...profiles.all.map((p) => ({ id: p.id, label: p.name }))],
			settings.startupProfileId ?? NO_STARTUP_PROFILE,
			(id) => settings.setStartupProfile(id === NO_STARTUP_PROFILE ? null : id),
		);
		this.device.sync(); // the applied profile may have been edited or deleted
	}

	private async saveAs(): Promise<void> {
		const { profiles } = this;
		const name = await askText(this.win, "Save Profile As", "Profile name:", uniqueName(profiles.active?.name ?? "My profile", profiles.names()));
		if (name) profiles.create(name, this.panel.settings);
	}
}
