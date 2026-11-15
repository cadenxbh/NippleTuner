import { QAction, QApplication, QKeySequence, QMenu, QMenuBar } from "@nodegui/nodegui";

/**
 * Menu bar framework: menus are declared as data (MENU_SPEC), every action
 * has a string id, and behaviour is attached with `menu.on(id, handler)`.
 * Actions without a handler log "not implemented".
 *
 * Dynamic lists (profiles, curves) live in named slots inside a menu and are
 * filled with setChoices(slot, ...); they behave like radio items.
 *
 * Memory safety: nodegui's QMenu.addSeparator() returns an unwrapped native
 * action and QMenu.clear() deletes actions Qt owns — both lead to objects
 * being freed twice once the garbage collector runs (the app segfaulted a
 * while after using the menus). So separators are ordinary QActions we keep
 * referenced, and menus are rebuilt with removeAction(), never clear().
 */

export type MenuId = string;

export interface ActionSpec {
	id: string;
	text: string;
	shortcut?: string;
	checkable?: boolean;
	checked?: boolean;
}

/** "-" = separator, { list } = named slot for setChoices(), { submenu } = a SUBMENU_SPEC id. */
export type MenuEntry = ActionSpec | "-" | { list: string; empty?: string } | { submenu: string };

export interface MenuSpec {
	id: MenuId;
	title: string;
	entries: MenuEntry[];
}

export const MENU_SPEC: MenuSpec[] = [
	{
		id: "file",
		title: "&File",
		entries: [
			{ id: "file.importProfile", text: "Import Profile…" },
			{ id: "file.exportProfile", text: "Export Profile…" },
			"-",
			{ id: "file.importCurve", text: "Import Curve…", shortcut: "Ctrl+O" },
			{ id: "file.exportCurve", text: "Export Curve…", shortcut: "Ctrl+E" },
			"-",
			{ id: "file.quit", text: "Quit", shortcut: "Ctrl+Q" },
		],
	},
	{
		id: "preferences",
		title: "&Preferences",
		entries: [
			{ submenu: "device" },
			"-",
			{ id: "prefs.independentAxes", text: "Independent X/Y Sensitivity", checkable: true },
			"-",
			{ id: "prefs.loadOnStartup", text: "Load on Startup", checkable: true },
			{ submenu: "startupProfile" },
			{ id: "prefs.showGuiOnStartup", text: "Show GUI on Startup", checkable: true },
			"-",
			{ id: "prefs.backgroundService", text: "Keep Applied Profile Running When Closed", checkable: true },
			"-",
			{ id: "prefs.graphsOnFocusOnly", text: "Update Graphs on Focus Only", checkable: true },
			{ submenu: "theme" },
			"-",
			{ id: "prefs.checkPermissions", text: "Check Permissions…" },
		],
	},
	{
		id: "profiles",
		title: "P&rofiles",
		entries: [
			{ id: "profiles.new", text: "New Profile…", shortcut: "Ctrl+N" },
			{ id: "profiles.save", text: "Save Profile", shortcut: "Ctrl+S" },
			{ id: "profiles.saveAs", text: "Save Profile As…", shortcut: "Ctrl+Shift+S" },
			{ id: "profiles.rename", text: "Rename Profile…" },
			{ id: "profiles.delete", text: "Delete Profile" },
			"-",
			{ id: "profiles.turnOff", text: "Turn Off Applied Profile" },
			"-",
			{ list: "profiles", empty: "(no saved profiles)" },
		],
	},
	{
		id: "curves",
		title: "&Curves",
		entries: [
			{ id: "curves.new", text: "New Curve…", shortcut: "Ctrl+Shift+N" },
			{ id: "curves.edit", text: "Edit Curve…" },
			{ id: "curves.duplicate", text: "Duplicate Curve" },
			{ id: "curves.rename", text: "Rename Curve…" },
			{ id: "curves.delete", text: "Delete Curve" },
			"-",
			{ id: "curves.reset", text: "Reset Curve Settings" },
			"-",
			{ list: "curves-builtin" },
			"-",
			{ list: "curves-custom", empty: "(no custom curves)" },
		],
	},
	{
		id: "help",
		title: "&Help",
		entries: [
			{ id: "help.quickStart", text: "Quick Start Guide", shortcut: "F1" },
			"-",
			{ id: "help.reportIssue", text: "Report an Issue…" },
		],
	},
];

/** Menus that only appear nested inside another menu. */
export const SUBMENU_SPEC: MenuSpec[] = [
	{
		id: "startupProfile",
		title: "Startup Profile",
		entries: [{ list: "startup-profile", empty: "(no saved profiles)" }],
	},
	{
		id: "theme",
		title: "Theme",
		entries: [{ list: "theme" }],
	},
	{
		id: "device",
		title: "Device",
		entries: [{ list: "device" }],
	},
];

export interface Choice {
	id: string;
	label: string;
}

type Handler = (checked: boolean) => unknown;

/** Never let an exception (or rejected promise) escape into a Qt signal callback. */
function safely(what: string, fn: () => unknown): void {
	const fail = (err: any) => console.error(`Menu action ${what} failed:`, err?.stack ?? err);
	try {
		const r = fn();
		if (r instanceof Promise) r.catch(fail);
	} catch (err: any) {
		fail(err);
	}
}

interface ChoiceSlot {
	/** Slots in the same group share one radio selection. */
	group: string;
	items: Choice[];
	selected: string | null;
	actions: QAction[];
	onSelect?: (id: string) => void;
}

export default class AppMenu {
	readonly bar: QMenuBar;
	private menus = new Map<MenuId, QMenu>();
	private specs = new Map<MenuId, MenuSpec>();
	private actions = new Map<string, QAction>();
	private handlers = new Map<string, Handler>();
	private slots = new Map<string, ChoiceSlot>();
	/** Actions currently in each menu (so they can be removed again). */
	private added = new Map<MenuId, QAction[]>();
	/** Every QAction wrapper ever created/returned, so none is collected while Qt uses it. */
	private keepAlive: QAction[] = [];
	private keepAliveOther: object[] = [];
	private submenuActions = new Map<string, QAction>();

	constructor(spec: MenuSpec[] = MENU_SPEC, submenus: MenuSpec[] = SUBMENU_SPEC) {
		this.bar = new QMenuBar();
		this.bar.setObjectName("menu-bar");

		// Submenus first so their parents can attach them.
		for (const m of submenus) {
			const menu = new QMenu();
			menu.setTitle(m.title);
			this.menus.set(m.id, menu);
			this.specs.set(m.id, m);
			for (const e of m.entries) {
				if (typeof e === "object" && "id" in e) this.actions.set(e.id, this.createAction(e));
			}
			this.build(m.id);
			const holder = this.newAction(); // the parent-menu entry that opens it
			holder.setText(m.title);
			holder.setMenu(menu);
			this.submenuActions.set(m.id, holder);
		}

		for (const m of spec) {
			const menu = new QMenu();
			menu.setTitle(m.title);
			this.menus.set(m.id, menu);
			this.specs.set(m.id, m);
			for (const e of m.entries) {
				if (typeof e === "object" && "id" in e) this.actions.set(e.id, this.createAction(e));
			}
			this.build(m.id);
			// addMenu returns a JS wrapper for the menu's title action that Qt
			// signals (hover etc.) are routed to; if it's garbage-collected,
			// hovering the menu bar calls into a dead object and segfaults.
			this.keepAliveOther.push(this.bar.addMenu(menu));
		}

		this.on("file.quit", () => QApplication.instance().quit());

	}

	/** Attach behaviour to an action. Replaces any previous handler. */
	on(id: string, handler: Handler): this {
		if (!this.actions.has(id)) throw new Error(`Unknown menu action: ${id}`);
		this.handlers.set(id, handler);
		return this;
	}

	action(id: string): QAction {
		const a = this.actions.get(id);
		if (!a) throw new Error(`Unknown menu action: ${id}`);
		return a;
	}

	/** Runs `fn` right before a menu (or submenu) opens, e.g. to refresh a list. */
	onMenuShow(menuId: MenuId, fn: () => void): void {
		this.menus.get(menuId)?.addEventListener("aboutToShow", () => safely(`${menuId}:aboutToShow`, fn));
	}

	setEnabled(id: string, enabled: boolean): void {
		this.action(id).setEnabled(enabled);
	}

	setChecked(id: string, checked: boolean): void {
		this.action(id).setChecked(checked);
	}

	isChecked(id: string): boolean {
		return this.action(id).isChecked();
	}

	/**
	 * Fills a list slot with radio-style items. Slots sharing a `group` act
	 * as one radio set (e.g. built-in + custom curves).
	 */
	setChoices(slot: string, items: Choice[], selected: string | null, onSelect: (id: string) => void, group = slot): void {
		this.slots.set(slot, { group, items, selected, actions: [], onSelect });
		const menuId = this.menuOfSlot(slot);
		if (menuId) this.build(menuId);
	}

	/** Moves the radio check within a group without firing onSelect. */
	select(group: string, id: string | null): void {
		for (const s of this.slots.values()) {
			if (s.group !== group) continue;
			s.selected = s.items.some((i) => i.id === id) ? id : null;
			s.items.forEach((item, i) => s.actions[i]?.setChecked(item.id === id));
		}
	}

	private menuOfSlot(slot: string): MenuId | undefined {
		for (const [id, spec] of this.specs) {
			if (spec.entries.some((e) => typeof e === "object" && "list" in e && e.list === slot)) return id;
		}
		return undefined;
	}

	private newAction(): QAction {
		const a = new QAction();
		this.keepAlive.push(a);
		return a;
	}

	private createAction(e: ActionSpec): QAction {
		const a = this.newAction();
		a.setText(e.text);
		if (e.shortcut) a.setShortcut(new QKeySequence(e.shortcut));
		if (e.checkable) {
			a.setCheckable(true);
			a.setChecked(!!e.checked);
		}
		a.addEventListener("triggered", (checked) => {
			const h = this.handlers.get(e.id);
			if (h) safely(e.id, () => h(checked));
			else console.log(`Menu "${e.text}" (${e.id}) is not implemented yet`);
		});
		return a;
	}

	private separator(): QAction {
		const a = this.newAction();
		a.setSeparator(true);
		return a;
	}

	private build(id: MenuId): void {
		const menu = this.menus.get(id)!;
		for (const a of this.added.get(id) ?? []) menu.removeAction(a);

		const list: QAction[] = [];
		for (const e of this.specs.get(id)!.entries) {
			if (e === "-") list.push(this.separator());
			else if ("list" in e) list.push(...this.buildSlot(e.list, e.empty));
			else if ("submenu" in e) list.push(this.submenuActions.get(e.submenu)!);
			else list.push(this.actions.get(e.id)!);
		}
		for (const a of list) menu.addAction(a);
		this.added.set(id, list);
	}

	private buildSlot(slot: string, empty?: string): QAction[] {
		const s = this.slots.get(slot);
		if (!s || s.items.length === 0) {
			if (!empty) return [];
			const a = this.newAction();
			a.setText(empty);
			a.setEnabled(false);
			return [a];
		}
		s.actions = s.items.map((item) => {
			const a = this.newAction();
			a.setText(item.label);
			a.setCheckable(true);
			a.setChecked(item.id === s.selected);
			a.addEventListener("triggered", () => {
				this.select(s.group, item.id);
				safely(item.id, () => s.onSelect?.(item.id));
			});
			return a;
		});
		return s.actions;
	}
}
