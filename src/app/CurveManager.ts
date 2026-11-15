import CurveLibrary, { CurveEntry } from "../curves/CurveLibrary";
import { CurvePoint } from "../curves/spline";
import AppMenu from "../menus/AppMenu";
import CurveEditorWindow from "../windows/CurveEditorWindow";
import MainWindow from "../windows/MainWindow";
import { askText, confirm } from "../windows/dialogs";
import { uniqueName } from "../util/storage";
import { DEFAULT_CURVE_ID } from "./constants";
import TuningPanel from "./TuningPanel";

/**
 * Curves: keeps the dropdown and the Curves menu lists in sync with the
 * library, and implements New / Edit / Duplicate / Rename / Delete / Reset.
 * Built-in curves are never modified (editing one makes a copy).
 */
export default class CurveManager {
	// Closed editor windows stay referenced; see windows/dialogs.ts for why.
	private editors: CurveEditorWindow[] = [];

	constructor(
		private win: MainWindow,
		private menu: AppMenu,
		private library: CurveLibrary,
		private panel: TuningPanel,
	) {
		library.onChange(() => this.refreshLists());
		panel.onCurveSelected((id) => {
			menu.select("curves", id);
			this.updateActions();
		});

		menu.on("curves.new", () => this.newCurve());
		menu.on("curves.edit", () => this.editCurve());
		menu.on("curves.duplicate", () => this.select(library.duplicate(panel.curveId).id));
		menu.on("curves.rename", () => this.renameCurve());
		menu.on("curves.delete", () => this.deleteCurve());
		menu.on("curves.reset", () => panel.resetSliders());
	}

	/** A curve editor window has keyboard focus. */
	get editorFocused(): boolean {
		return this.editors.some((e) => e.isVisible() && e.isActiveWindow());
	}

	get current(): CurveEntry {
		return this.library.get(this.panel.curveId) ?? this.library.get(DEFAULT_CURVE_ID)!;
	}

	select(id: string): void {
		this.panel.selectCurve(id);
	}

	/** Rebuilds the dropdown and both Curves menu lists from the library. */
	refreshLists(): void {
		const toItems = (list: CurveEntry[]) => list.map((c) => ({ id: c.id, name: c.name }));
		this.panel.setCurveList(toItems(this.library.builtins), toItems(this.library.customs));
		const id = this.panel.curveId;
		const toChoices = (list: CurveEntry[]) => list.map((c) => ({ id: c.id, label: c.name }));
		this.menu.setChoices("curves-builtin", toChoices(this.library.builtins), id, (i) => this.select(i), "curves");
		this.menu.setChoices("curves-custom", toChoices(this.library.customs), id, (i) => this.select(i), "curves");
		this.updateActions();
	}

	/** Rename/delete only make sense for custom curves. */
	private updateActions(): void {
		const custom = !this.current.builtin;
		this.menu.setEnabled("curves.rename", custom);
		this.menu.setEnabled("curves.delete", custom);
		this.menu.action("curves.edit").setText(custom ? "Edit Curve…" : "Edit Curve… (makes a copy)");
	}

	private openEditor(title: string, name: string, points: CurvePoint[], onSave: (name: string, pts: CurvePoint[]) => void): void {
		const ed = new CurveEditorWindow(this.library, { title, name, points, onSave });
		this.editors.push(ed);
		ed.show();
	}

	private newCurve(): void {
		const lib = this.library;
		this.openEditor("New Curve", uniqueName("New curve", lib.names()), lib.pointsOf(this.panel.curveId, 9), (name, pts) => {
			this.select(lib.add(name, pts).id);
		});
	}

	private editCurve(): void {
		const lib = this.library;
		const entry = this.current;
		if (entry.builtin) {
			// Built-ins stay intact: edit a copy instead.
			this.openEditor(`New Curve (from ${entry.name})`, uniqueName(`${entry.name} custom`, lib.names()), lib.pointsOf(entry.id, 9), (name, pts) => {
				this.select(lib.add(name, pts).id);
			});
			return;
		}
		this.openEditor(`Edit Curve — ${entry.name}`, entry.name, lib.pointsOf(entry.id), (name, pts) => {
			lib.update(entry.id, pts, name);
			this.select(entry.id);
		});
	}

	private async renameCurve(): Promise<void> {
		const entry = this.current;
		if (entry.builtin) return;
		const name = await askText(this.win, "Rename Curve", "New name:", entry.name);
		if (name) this.library.rename(entry.id, name);
	}

	private async deleteCurve(): Promise<void> {
		const entry = this.current;
		if (entry.builtin) return;
		if (await confirm(this.win, "Delete Curve", `Delete the curve "${entry.name}"?`, "Delete")) {
			this.library.remove(entry.id); // refreshLists falls back to the default curve
		}
	}
}
