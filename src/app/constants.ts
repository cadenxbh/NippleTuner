/** Max counts/report measured at a hard push with firmware sensitivity 128. */
export const MEASURED_MAX_COUNTS = 152;
export const MEASURED_AT_SENSITIVITY = 128;
/** PS/2 reports carry at most ±255 per axis. */
export const PS2_MAX_COUNTS = 255;
/** Report interval assumed when no device is available. */
export const DEFAULT_INTERVAL_MS = 10;
/**
 * Display smoothing time constant. The stick only reports whole counts, so
 * some averaging over time is needed to get positions between integer steps.
 */
export const SMOOTHING_MS = 39;

export const DEFAULT_CURVE_ID = "linear";
export const DEFAULTS = { deadzone: 0, sensitivity: 1, step: 0.2 };


export const FILE_FORMATS = {
	profile: "nippletuner-profile",
	curve: "nippletuner-curve",
};
