import { PointerDevice } from "../pointer";
import { ProfileSettings } from "../profiles/ProfileStore";
import { Tuning } from "./tuning";

export interface DeviceTarget {
	/** Settings being edited in the window (used while testing). */
	editing: () => ProfileSettings;
	/** Looks up a saved profile's settings. */
	profile: (id: string) => ProfileSettings | undefined;
	/** Settings → curve + sensitivity. */
	tune: (s: ProfileSettings) => Tuning;
}

/**
 * Decides what the real pointer runs:
 *   testing          → the window's current (unsaved) settings
 *   appliedProfileId → that saved profile (keeps running with the window hidden)
 *   neither          → pointer untouched (no grab)
 */
export default class DeviceController {
	private testingOn = false;
	private appliedId: string | null = null;
	private listeners: (() => void)[] = [];

	constructor(
		private device: PointerDevice | null,
		private target: DeviceTarget,
		private onError: (title: string, message: string) => void,
	) {}

	get tp(): PointerDevice | null {
		return this.device;
	}

	get available(): boolean {
		return !!this.device;
	}

	/**
	 * Switches to a different device: the old one is released (grab dropped,
	 * reading stopped) and whatever was running continues on the new one.
	 */
	setDevice(tp: PointerDevice | null): void {
		if (this.device && this.device !== tp) this.device.stop();
		this.device = tp;
		this.sync();
	}

	get testing(): boolean {
		return this.testingOn;
	}

	get appliedProfileId(): string | null {
		return this.appliedId;
	}

	/** Called after every state change (for buttons, title, tray). */
	onChange(listener: () => void): void {
		this.listeners.push(listener);
	}

	setTesting(on: boolean): void {
		this.testingOn = on;
		this.sync();
	}

	/** Applies a saved profile (null = turn off). Ends any test. */
	apply(profileId: string | null): void {
		this.testingOn = false;
		this.appliedId = profileId;
		this.sync();
	}

	/** Re-reads settings and updates the pointer (cheap; call after any change). */
	sync(): void {
		const tp = this.tp;
		if (this.appliedId && !this.target.profile(this.appliedId)) this.appliedId = null; // deleted
		if (tp) {
			const settings = this.testingOn ? this.target.editing() : this.appliedId ? this.target.profile(this.appliedId) : undefined;
			if (!settings) {
				tp.disableCurve();
			} else {
				const { curve, sens } = this.target.tune(settings);
				tp.setCurve(curve);
				tp.setAxisSensitivity(sens.x, sens.y);
				if (!tp.isCurveEnabled) {
					try {
						tp.enableCurve();
					} catch (err: any) {
						this.testingOn = false;
						this.appliedId = null;
						const msg = err?.message ?? String(err);
						if (/EVIOCGRAB.*errno 16/.test(msg)) {
							this.onError(
								"Another program is controlling the TrackPoint",
								"NippleTuner couldn't take control of the TrackPoint because another program already has exclusive control of it " +
								"(for example another copy of NippleTuner, or a remapping tool like input-remapper with a TrackPoint preset). " +
								"Close that program, then try again.",
							);
						} else {
							this.onError("Couldn't take over the TrackPoint", msg);
						}
					}
				}
			}
		}
		for (const l of this.listeners) l();
	}

	/** Releases the device (on quit). */
	stop(): void {
		this.device?.stop();
	}
}
