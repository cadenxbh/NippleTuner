import CurveLibrary, { CurveEntry } from "../curves/CurveLibrary";
import { ProfileSettings } from "../profiles/ProfileStore";
import { AccelCurve, makePresetCurve, resolveZones } from "../pointer";
import { DEFAULT_CURVE_ID } from "./constants";

/** Everything needed to run or draw a set of settings. */
export interface Tuning {
	entry: CurveEntry;
	curve: AccelCurve;
	/** Per-axis output multipliers, applied after the curve. */
	sens: { x: number; y: number };
	/** Deadzone/limit as the curve really uses them (snapped to its samples). */
	deadzone: number;
	limit: number;
	limited: boolean;
	maxSpeed: number;
}

/**
 * Turns settings into a curve. Sensitivity isn't baked into the curve; the
 * device applies it per axis after the curve.
 */
export function buildTuning(s: ProfileSettings, library: CurveLibrary, maxSpeed: number): Tuning {
	const entry = library.get(s.curveId) ?? library.get(DEFAULT_CURVE_ID)!;
	const opts = { maxInput: maxSpeed, step: s.step, deadzone: s.deadzone, limit: s.limit ?? maxSpeed, sensitivity: 1 };
	const { deadzone, limit, limited } = resolveZones(opts);
	return {
		entry,
		curve: makePresetCurve(entry, opts),
		sens: s.independentAxes ? { x: s.sensitivityX, y: s.sensitivityY } : { x: s.sensitivity, y: s.sensitivity },
		deadzone,
		limit,
		limited,
		maxSpeed,
	};
}
