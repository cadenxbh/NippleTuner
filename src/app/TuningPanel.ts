import MainWindow from "../windows/MainWindow";
import { ProfileSettings } from "../profiles/ProfileStore";
import { resolveZones } from "../pointer";
import { DEFAULT_CURVE_ID, DEFAULTS } from "./constants";
import StickRange from "./StickRange";

export interface CurveListItem {
	id: string;
	name: string;
}

/**
 * The editing controls of the main window (curve dropdown, sliders, X/Y
 * toggle) as one object: read them as ProfileSettings, set them from
 * ProfileSettings, and get a single change notification per edit.
 */
export default class TuningPanel {
	private curve = DEFAULT_CURVE_ID;
	private comboIds: (string | null)[] = []; // null = separator row
	private syncingCombo = false;
	private togglingAxes = false;
	/** Mode last applied (null until the first call), so repeats are ignored. */
	private lastAxesMode: boolean | null = null;
	private batchDepth = 0;
	private changedInBatch = false;
	private changeListeners: (() => void)[] = [];
	private curveListeners: ((id: string) => void)[] = [];
	private axesListeners: ((independent: boolean) => void)[] = [];

	constructor(private win: MainWindow, private range: StickRange) {
		const { deadzoneSlider, sensitivitySlider, sensXSlider, sensYSlider, limitSlider, stepSlider } = win;

		this.updateRanges();
		deadzoneSlider.setValue(DEFAULTS.deadzone);
		limitSlider.setValue(range.maxSpeed);

		for (const s of [deadzoneSlider, sensitivitySlider, sensXSlider, sensYSlider, limitSlider]) {
			s.onChange(() => this.changed());
		}
		stepSlider.onChange(() => {
			this.updateRanges(); // re-snaps deadzone/limit to the new step
			this.changed();
		});
		win.independentCheck.addEventListener("toggled", (on) => this.setIndependent(on));
		win.presetBox.addEventListener("currentIndexChanged", (i) => {
			if (this.syncingCombo) return;
			const id = this.comboIds[i];
			if (id) this.selectCurve(id);
		});

		// Keep "limit = no limit" when the range changes (grows, or another device).
		let prevMax = range.maxSpeed;
		range.onChange(() => {
			this.batch(() => {
				const atMax = limitSlider.value >= prevMax - 1e-9;
				this.updateRanges();
				if (atMax) limitSlider.setValue(range.maxSpeed);
			});
			prevMax = range.maxSpeed;
		});
	}

	// --- notifications ------------------------------------------------------

	/** Any setting changed (once per edit / batch). */
	onChange(listener: () => void): void {
		this.changeListeners.push(listener);
	}

	/** The selected curve changed. */
	onCurveSelected(listener: (id: string) => void): void {
		this.curveListeners.push(listener);
	}

	/** Shared vs. independent X/Y sensitivity changed. */
	onAxesModeChanged(listener: (independent: boolean) => void): void {
		this.axesListeners.push(listener);
	}

	/** Runs `fn` with change notifications collapsed into one at the end. */
	batch(fn: () => void): void {
		this.batchDepth++;
		try {
			fn();
		} finally {
			this.batchDepth--;
		}
		if (this.batchDepth === 0 && this.changedInBatch) {
			this.changedInBatch = false;
			this.changed();
		}
	}

	private changed(): void {
		if (this.batchDepth > 0) {
			this.changedInBatch = true;
			return;
		}
		for (const l of this.changeListeners) l();
	}

	// --- settings -------------------------------------------------------------

	get curveId(): string {
		return this.curve;
	}

	get independentAxes(): boolean {
		return this.win.independentAxes;
	}

	get settings(): ProfileSettings {
		const w = this.win;
		const { limited } = resolveZones({ maxInput: this.range.maxSpeed, step: w.stepSlider.value, limit: w.limitSlider.value });
		return {
			curveId: this.curve,
			deadzone: w.deadzoneSlider.value,
			limit: limited ? w.limitSlider.value : null,
			step: w.stepSlider.value,
			independentAxes: w.independentAxes,
			sensitivity: w.sensitivitySlider.value,
			sensitivityX: w.sensXSlider.value,
			sensitivityY: w.sensYSlider.value,
		};
	}

	/** Puts every control into the given state. */
	setSettings(s: ProfileSettings): void {
		const w = this.win;
		this.batch(() => {
			w.stepSlider.setValue(s.step ?? DEFAULTS.step);
			this.updateRanges();
			w.deadzoneSlider.setValue(s.deadzone ?? DEFAULTS.deadzone);
			w.limitSlider.setValue(s.limit ?? this.range.maxSpeed);
			w.sensitivitySlider.setValue(s.sensitivity ?? DEFAULTS.sensitivity);
			w.sensXSlider.setValue(s.sensitivityX ?? DEFAULTS.sensitivity);
			w.sensYSlider.setValue(s.sensitivityY ?? DEFAULTS.sensitivity);
			this.setIndependent(!!s.independentAxes, false);
			this.selectCurve(s.curveId);
		});
	}

	/** Sliders back to defaults (curve selection unchanged). */
	resetSliders(): void {
		const w = this.win;
		this.batch(() => {
			w.stepSlider.setValue(DEFAULTS.step);
			this.updateRanges();
			w.deadzoneSlider.setValue(DEFAULTS.deadzone);
			w.limitSlider.setValue(this.range.maxSpeed);
			for (const s of [w.sensitivitySlider, w.sensXSlider, w.sensYSlider]) s.setValue(DEFAULTS.sensitivity);
		});
	}

	/**
	 * One shared sensitivity or separate X/Y. With `carry`, the current value
	 * is copied across so toggling doesn't change behaviour.
	 */
	setIndependent(on: boolean, carry = true): void {
		// Updating the checkbox below fires its event again; ignore that.
		if (this.togglingAxes) return;
		if (on === this.lastAxesMode) return;
		this.togglingAxes = true;
		const w = this.win;
		this.batch(() => {
			if (carry) {
				if (on) {
					w.sensXSlider.setValue(w.sensitivitySlider.value);
					w.sensYSlider.setValue(w.sensitivitySlider.value);
				} else {
					w.sensitivitySlider.setValue(w.sensXSlider.value);
				}
			}
			w.setIndependentAxes(on);
			this.changed();
		});
		this.togglingAxes = false;
		this.lastAxesMode = on;
		for (const l of this.axesListeners) l(on);
	}

	// --- curve selection ------------------------------------------------------

	/** Fills the dropdown: built-ins, a separator, then custom curves. */
	setCurveList(builtins: CurveListItem[], customs: CurveListItem[]): void {
		const box = this.win.presetBox;
		this.syncingCombo = true;
		box.clear();
		this.comboIds = [];
		for (const c of builtins) {
			box.addItem(undefined, c.name);
			this.comboIds.push(c.id);
		}
		if (customs.length) {
			box.insertSeparator(box.count());
			this.comboIds.push(null);
			for (const c of customs) {
				box.addItem(undefined, c.name);
				this.comboIds.push(c.id);
			}
		}
		this.syncingCombo = false;
		// The selected curve may have been deleted.
		this.selectCurve(this.comboIds.includes(this.curve) ? this.curve : DEFAULT_CURVE_ID, true);
	}

	selectCurve(id: string, force = false): void {
		if (!this.comboIds.includes(id)) id = DEFAULT_CURVE_ID;
		const changed = id !== this.curve;
		this.curve = id;
		this.syncingCombo = true;
		this.win.presetBox.setCurrentIndex(this.comboIds.indexOf(id));
		this.syncingCombo = false;
		if (changed || force) {
			for (const l of this.curveListeners) l(id);
			this.changed();
		}
	}

	// --- ranges -----------------------------------------------------------------

	/**
	 * Deadzone and limit move in curve steps, so every value they can take
	 * lands exactly on a curve sample (see resolveZones).
	 */
	private updateRanges(): void {
		const max = this.range.maxSpeed;
		const step = this.win.stepSlider.value;
		this.win.deadzoneSlider.setRange(0, max * 0.5, step);
		this.win.limitSlider.setRange(step, max, step);
	}
}
