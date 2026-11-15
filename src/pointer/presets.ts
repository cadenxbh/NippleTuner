import { AccelCurve } from "./AccelCurve";

/**
 * A curve shape on the unit square: shape(0) = 0, shape(1) = 1, x in [0, 1].
 * makePresetCurve() scales it to real speeds.
 */
export interface CurvePreset {
	id: string;
	name: string;
	shape: (x: number) => number;
}

const EXP_K = 4;
const LOG_K = 9;

export const CURVE_PRESETS: CurvePreset[] = [
	{ id: "linear", name: "Linear", shape: (x) => x },
	{ id: "quadratic", name: "Quadratic (x²)", shape: (x) => x * x },
	{ id: "cubic", name: "Cubic (x³)", shape: (x) => x * x * x },
	{ id: "quartic", name: "Quartic (x⁴)", shape: (x) => x * x * x * x },
	{ id: "sine", name: "Sine ease-in", shape: (x) => 1 - Math.cos((x * Math.PI) / 2) },
	{ id: "sine-s", name: "Sine S-curve", shape: (x) => (1 - Math.cos(x * Math.PI)) / 2 },
	{ id: "smoothstep", name: "Smoothstep", shape: (x) => x * x * (3 - 2 * x) },
	{ id: "exp", name: "Exponential", shape: (x) => (Math.exp(EXP_K * x) - 1) / (Math.exp(EXP_K) - 1) },
	{ id: "sqrt", name: "Square root", shape: (x) => Math.sqrt(x) },
	{ id: "log", name: "Logarithmic", shape: (x) => Math.log1p(LOG_K * x) / Math.log1p(LOG_K) },
];

export interface PresetCurveOptions {
	/** Highest input speed (units/ms) the curve is sampled to (the stick's full scale). */
	maxInput: number;
	/** Input speed below which output is 0. Snapped to the step grid. Default 0. */
	deadzone?: number;
	/** Input speed where the curve tops out; output is flat beyond it. Snapped to the step grid. Default maxInput. */
	limit?: number;
	/** Output multiplier. At 1 the curve reaches the 1:1 line at `limit`. Default 1. */
	sensitivity?: number;
	/** Sampling interval in units/ms. Default maxInput / 64. */
	step?: number;
	/**
	 * 0..1: blend with a straight line so slow movement isn't dead
	 * (0 = pure shape, 1 = pure linear). Default 0.
	 */
	linearBlend?: number;
}

/**
 * The curve is piecewise-linear between samples spaced `step` apart, so a
 * corner (deadzone edge, limit) is only exact if it lies on a sample. This
 * returns the deadzone/limit that makePresetCurve will actually use.
 * A limit at (or within half a step of) maxInput means "no limit".
 */
export function resolveZones(opts: PresetCurveOptions): { step: number; deadzone: number; limit: number; limited: boolean } {
	const max = opts.maxInput;
	const step = opts.step ?? max / 64;
	const snap = (v: number) => Math.round(v / step) * step;
	const rawLimit = opts.limit ?? max;
	const limited = rawLimit < max - step / 2;
	const limit = limited ? Math.max(step, snap(rawLimit)) : max;
	const deadzone = Math.min(Math.max(0, snap(opts.deadzone ?? 0)), limited ? limit - step : snap(max) - step);
	return { step, deadzone, limit, limited };
}

export function makePresetCurve(preset: CurvePreset | string, opts: PresetCurveOptions): AccelCurve {
	const p = typeof preset === "string" ? CURVE_PRESETS.find((c) => c.id === preset) : preset;
	if (!p) throw new Error(`Unknown curve preset: ${preset}`);
	const max = opts.maxInput;
	const { step, deadzone: dz, limit, limited } = resolveZones(opts);
	const sens = opts.sensitivity ?? 1;
	const blend = Math.min(1, Math.max(0, opts.linearBlend ?? 0));
	const top = sens * limit;

	return AccelCurve.fromFunction(
		(v) => {
			if (v <= dz + 1e-9) return 0;
			// Flat beyond an explicit limit; otherwise the shape simply continues.
			const x = (v - dz) / (limit - dz);
			if (limited && x >= 1) return top;
			return top * (blend * x + (1 - blend) * p.shape(x));
		},
		step,
		max,
	);
}
