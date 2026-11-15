import { PointerDevice } from "../pointer";
import { DEFAULT_INTERVAL_MS, MEASURED_AT_SENSITIVITY, MEASURED_MAX_COUNTS, PS2_MAX_COUNTS } from "./constants";

/**
 * How far the stick can go: the full-scale delta per report and the report
 * interval, which together give the maximum input speed every curve and
 * view is scaled to.
 */
export default class StickRange {
	private intervalMs = DEFAULT_INTERVAL_MS;
	private fullScaleCounts = MEASURED_MAX_COUNTS;
	private listeners: (() => void)[] = [];

	constructor(tp: PointerDevice | null) {
		this.measure(tp);
	}

	/** Report interval of the current device (ms). */
	get interval(): number {
		return this.intervalMs;
	}

	/** Re-measures for a different device (Preferences → Device) and notifies. */
	setDevice(tp: PointerDevice | null): void {
		this.measure(tp);
		for (const l of this.listeners) l();
	}

	private measure(tp: PointerDevice | null): void {
		this.intervalMs = tp?.options.nominalIntervalMs ?? DEFAULT_INTERVAL_MS;
		// Sensitivity is a linear multiplier in TrackPoint firmware (128 = 1.0x),
		// so scale the measured maximum by it. Non-TrackPoints fall back to the
		// measured value.
		const hw = Number(tp?.readHardwareSetting("sensitivity")) || MEASURED_AT_SENSITIVITY;
		this.fullScaleCounts = Math.min(PS2_MAX_COUNTS, (MEASURED_MAX_COUNTS * hw) / MEASURED_AT_SENSITIVITY);
	}

	/** Full-scale delta per report (counts). */
	get fullScale(): number {
		return this.fullScaleCounts;
	}

	/** Full-scale input speed (counts/ms). */
	get maxSpeed(): number {
		return this.fullScaleCounts / this.interval;
	}

	/** Called after the range changes (grew, or a different device). */
	onChange(listener: () => void): void {
		this.listeners.push(listener);
	}

	/** Safety net in case the estimate is low: grow to an observed magnitude. */
	observe(countsPerReport: number): void {
		if (countsPerReport <= this.fullScaleCounts) return;
		this.fullScaleCounts = countsPerReport;
		console.log(`Full scale grew to ${countsPerReport.toFixed(1)} counts/report`);
		for (const l of this.listeners) l();
	}
}
