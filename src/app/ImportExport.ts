import * as fs from "fs";
import CurveLibrary from "../curves/CurveLibrary";
import { CurvePoint } from "../curves/spline";
import AppMenu from "../menus/AppMenu";
import ProfileStore, { ProfileSettings } from "../profiles/ProfileStore";
import MainWindow from "../windows/MainWindow";
import { openFile, saveFile, showError } from "../windows/dialogs";
import { DEFAULT_CURVE_ID, FILE_FORMATS } from "./constants";
import CurveManager from "./CurveManager";
import ProfileManager from "./ProfileManager";
import TuningPanel from "./TuningPanel";
import { Tuning } from "./tuning";

function isPointList(v: unknown): v is CurvePoint[] {
	return Array.isArray(v) && v.length >= 2 && v.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && isFinite(n)));
}

function samePoints(a: CurvePoint[], b: CurvePoint[]): boolean {
	return a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-9 && Math.abs(p[1] - b[i][1]) < 1e-9);
}

function fileSafe(name: string): string {
	return name.replace(/[^\w.-]+/g, "_");
}

/** File menu: import/export profiles and curves as JSON. */
export default class ImportExport {
	constructor(
		private win: MainWindow,
		menu: AppMenu,
		private library: CurveLibrary,
		private profiles: ProfileStore,
		private panel: TuningPanel,
		private curves: CurveManager,
		private profileManager: ProfileManager,
		private currentTuning: () => Tuning,
	) {
		menu.on("file.exportCurve", this.guard("Export Curve", () => this.exportCurve()));
		menu.on("file.importCurve", this.guard("Import Curve", () => this.importCurve()));
		menu.on("file.exportProfile", this.guard("Export Profile", () => this.exportProfile()));
		menu.on("file.importProfile", this.guard("Import Profile", () => this.importProfile()));
	}

	private guard(title: string, fn: () => Promise<void>): () => void {
		return () => {
			fn().catch((err: any) => showError(this.win, title, err?.message ?? String(err)));
		};
	}

	private async exportCurve(): Promise<void> {
		const entry = this.curves.current;
		const file = await saveFile(this.win, "Export Curve", `${fileSafe(entry.name)}.curve.json`);
		if (!file) return;
		fs.writeFileSync(file, JSON.stringify({
			format: FILE_FORMATS.curve,
			version: 1,
			name: entry.name,
			// Shape on the unit square (what import reads back).
			points: this.library.pointsOf(entry.id),
			// The low-level speed curve for the current settings, for reference.
			accelCurve: this.currentTuning().curve.toJSON(),
		}, null, 2));
	}

	private async importCurve(): Promise<void> {
		const file = await openFile(this.win, "Import Curve");
		if (!file) return;
		const data = JSON.parse(fs.readFileSync(file, "utf8"));
		if (data?.format !== FILE_FORMATS.curve || !isPointList(data.points)) {
			throw new Error("That file isn't a NippleTuner curve.");
		}
		this.curves.select(this.library.add(String(data.name ?? "Imported curve"), data.points).id);
	}

	private async exportProfile(): Promise<void> {
		const name = this.profiles.active?.name ?? "Untitled profile";
		const file = await saveFile(this.win, "Export Profile", `${fileSafe(name)}.profile.json`);
		if (!file) return;
		const entry = this.curves.current;
		fs.writeFileSync(file, JSON.stringify({
			format: FILE_FORMATS.profile,
			version: 1,
			name,
			settings: this.panel.settings,
			// Custom curves travel with the profile so it works on another machine.
			curve: entry.builtin ? undefined : { name: entry.name, points: entry.points },
		}, null, 2));
	}

	private async importProfile(): Promise<void> {
		const file = await openFile(this.win, "Import Profile");
		if (!file) return;
		const data = JSON.parse(fs.readFileSync(file, "utf8"));
		if (data?.format !== FILE_FORMATS.profile || typeof data.settings !== "object") {
			throw new Error("That file isn't a NippleTuner profile.");
		}
		const settings: ProfileSettings = { ...this.panel.settings, ...data.settings };
		if (data.curve && isPointList(data.curve.points)) {
			// Reuse an identical custom curve if we already have it.
			const existing = this.library.customs.find((c) => c.name === data.curve.name && samePoints(c.points!, data.curve.points));
			settings.curveId = existing ? existing.id : this.library.add(String(data.curve.name ?? "Imported curve"), data.curve.points).id;
		}
		if (!this.library.get(settings.curveId)) settings.curveId = DEFAULT_CURVE_ID;
		const p = this.profiles.create(String(data.name ?? "Imported profile"), settings);
		this.profileManager.load(p.id);
	}
}
