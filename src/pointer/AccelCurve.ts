/**
 * Pointer acceleration curve, modelled on libinput's "custom" acceleration
 * profile so values are interchangeable with libinput docs/tools:
 *
 *   points[i] = output speed at input speed (i * step)
 *
 * Speeds are in device units per millisecond. Between points the curve is
 * linearly interpolated; beyond the last point it is extrapolated along the
 * last segment. Typically points[0] = 0.
 */
export interface AccelCurveJSON {
	step: number;
	points: number[];
}

export class AccelCurve {
	readonly step: number;
	readonly points: readonly number[];

	constructor(step: number, points: number[]) {
		if (!(step > 0) || !isFinite(step)) throw new Error(`Invalid step ${step}`);
		if (points.length < 2) throw new Error("A curve needs at least 2 points");
		if (points.some((p) => !isFinite(p) || p < 0)) throw new Error("Curve points must be finite and >= 0");
		this.step = step;
		this.points = Object.freeze([...points]);
	}

	/** Identity curve (output == input), i.e. no acceleration. */
	static identity(step = 1, count = 2): AccelCurve {
		return AccelCurve.fromFunction((v) => v, step, step * (count - 1));
	}

	/** Constant gain: output = gain * input. */
	static linear(gain: number, step = 1): AccelCurve {
		return new AccelCurve(step, [0, gain * step]);
	}

	/**
	 * Samples an arbitrary speed -> speed function at the given step interval
	 * from 0 up to and including `maxInput`.
	 */
	static fromFunction(fn: (inputSpeed: number) => number, step: number, maxInput: number): AccelCurve {
		const n = Math.max(2, Math.ceil(maxInput / step) + 1);
		const pts: number[] = [];
		for (let i = 0; i < n; i++) pts.push(Math.max(0, fn(i * step)));
		return new AccelCurve(step, pts);
	}

	/** Same as fromFunction but you describe the curve as a gain multiplier. */
	static fromGain(gainFn: (inputSpeed: number) => number, step: number, maxInput: number): AccelCurve {
		return AccelCurve.fromFunction((v) => v * gainFn(v), step, maxInput);
	}

	static fromJSON(json: AccelCurveJSON | string): AccelCurve {
		const o: AccelCurveJSON = typeof json === "string" ? JSON.parse(json) : json;
		return new AccelCurve(o.step, o.points);
	}

	toJSON(): AccelCurveJSON {
		return { step: this.step, points: [...this.points] };
	}

	/** Highest input speed explicitly defined by a point. */
	get maxInput(): number {
		return this.step * (this.points.length - 1);
	}

	/** Output speed for an input speed (units/ms). */
	evaluate(inputSpeed: number): number {
		if (inputSpeed <= 0) return 0;
		const pos = inputSpeed / this.step;
		const last = this.points.length - 1;
		let i = Math.floor(pos);
		if (i >= last) i = last - 1; // extrapolate along final segment
		const t = pos - i;
		const out = this.points[i] + (this.points[i + 1] - this.points[i]) * t;
		return Math.max(0, out);
	}

	/** Multiplier applied to motion at the given input speed (output / input). */
	gainAt(inputSpeed: number): number {
		if (inputSpeed <= 0) {
			// limit at 0: slope of first segment
			return (this.points[1] - this.points[0]) / this.step;
		}
		return this.evaluate(inputSpeed) / inputSpeed;
	}

	/**
	 * Re-samples this curve at a different step interval. Covers at least the
	 * current input range unless `maxInput` is given.
	 */
	resample(step: number, maxInput = this.maxInput): AccelCurve {
		return AccelCurve.fromFunction((v) => this.evaluate(v), step, maxInput);
	}

	/** Returns a copy with point `index` replaced. */
	withPoint(index: number, outputSpeed: number): AccelCurve {
		const pts = [...this.points];
		while (pts.length <= index) pts.push(this.evaluate(pts.length * this.step));
		pts[index] = outputSpeed;
		return new AccelCurve(this.step, pts);
	}
}
