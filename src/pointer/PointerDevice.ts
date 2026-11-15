import { EventEmitter } from "events";
import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { AccelCurve } from "./AccelCurve";
import { findTrackPoint, listPointerDevices, PointerDeviceInfo, VIRTUAL_NAME_SUFFIX } from "./devices";
import {
	BUS_VIRTUAL,
	EV_KEY,
	EV_MAX,
	EV_MSC,
	EV_REL,
	EV_SYN,
	EVIOCGRAB,
	EVIOCREVOKE,
	INPUT_EVENT_SIZE,
	InputEvent,
	ioctlBuffer,
	ioctlValue,
	KEY_MAX,
	makeUinputSetup,
	MSC_MAX,
	queryBits,
	queryId,
	queryProps,
	readInputEvent,
	REL_MAX,
	REL_X,
	REL_Y,
	SYN_DROPPED,
	SYN_REPORT,
	UI_DEV_CREATE,
	UI_DEV_DESTROY,
	UI_DEV_SETUP,
	UI_SET_EVBIT,
	UI_SET_KEYBIT,
	UI_SET_MSCBIT,
	UI_SET_PROPBIT,
	UI_SET_RELBIT,
	writeInputEvents,
} from "./linux-input";

/** One motion report (one evdev frame that contained REL_X and/or REL_Y). */
export interface DeltaEvent {
	/** Raw device delta, device units. */
	dx: number;
	dy: number;
	/** Kernel timestamp of the frame, ms. */
	time: number;
	/** ms since the previous motion frame (nominal interval after idle). */
	dt: number;
	/** Instantaneous speed, units/ms (|d| / dt). */
	rawSpeed: number;
	/** Smoothed speed over `smoothingMs`, units/ms. This is what the curve sees. */
	speed: number;
}

/** Emitted while the curve is being applied. */
export interface OutputEvent extends DeltaEvent {
	/** Delta actually injected (integer, with sub-unit remainders carried over). */
	outDx: number;
	outDy: number;
	/** Curve multiplier for this frame (curve output speed / input speed), before axis sensitivity. */
	gain: number;
}

export interface PointerDeviceOptions {
	/** Window used to smooth the velocity estimate. Default 30 ms. */
	smoothingMs?: number;
	/** Report interval assumed after idle. Default: 1000 / sysfs `rate`, else 10 ms. */
	nominalIntervalMs?: number;
	/** A gap longer than this resets velocity/remainders. Default 5 * nominal interval. */
	idleResetMs?: number;
	/**
	 * On X11, set the virtual output device to libinput's flat profile so the
	 * desktop's own acceleration does not stack on top of the curve. Default true.
	 */
	flattenXAccel?: boolean;
}

/** sysfs attributes a pointing stick driver may expose (psmouse trackpoint). */
const HARDWARE_ATTRS = [
	"sensitivity", "speed", "inertia", "reach", "draghys", "mindrag", "thresh",
	"upthresh", "ztime", "jenks", "skipback", "ext_dev", "press_to_select",
	"drift_time", "rate", "resolution",
];

export declare interface PointerDevice {
	on(event: "delta", listener: (e: DeltaEvent) => void): this;
	on(event: "output", listener: (e: OutputEvent) => void): this;
	on(event: "event", listener: (e: InputEvent) => void): this;
	on(event: "frame", listener: (events: InputEvent[]) => void): this;
	on(event: "error", listener: (err: Error) => void): this;
	on(event: "start" | "stop" | "remap-start" | "remap-stop", listener: () => void): this;
}

/**
 * A relative pointer device (aimed at TrackPoints, works with any mouse-like
 * evdev device).
 *
 *  - start() reads raw deltas and emits "delta" events (needs read access to
 *    the /dev/input/eventN node, e.g. membership of the `input` group).
 *  - enableCurve() grabs the device exclusively, applies the AccelCurve and
 *    re-injects motion through a virtual uinput device (needs /dev/uinput
 *    write access).
 */
export class PointerDevice extends EventEmitter {
	readonly info: PointerDeviceInfo;
	readonly options: Required<PointerDeviceOptions>;

	private fd: number | null = null;
	private stream: fs.ReadStream | null = null;
	private pending = Buffer.alloc(0);
	private frame: InputEvent[] = [];
	private dropping = false;

	private uinputFd: number | null = null;
	private curve: AccelCurve | null = null;

	private lastMotionTime = -Infinity;
	private history: { time: number; dist: number }[] = [];
	private sensX = 1;
	private sensY = 1;
	private remX = 0;
	private remY = 0;

	// --- construction -----------------------------------------------------

	static list(): PointerDeviceInfo[] {
		return listPointerDevices();
	}

	/** Opens the first TrackPoint / pointing stick on the system. */
	static trackPoint(options?: PointerDeviceOptions): PointerDevice {
		const info = findTrackPoint();
		if (!info) throw new Error("No TrackPoint / pointing stick found");
		return new PointerDevice(info, options);
	}

	/** By devnode ("/dev/input/event6"), exact name, or a PointerDeviceInfo. */
	static from(device: string | PointerDeviceInfo, options?: PointerDeviceOptions): PointerDevice {
		if (typeof device !== "string") return new PointerDevice(device, options);
		const info = listPointerDevices().find((d) => d.devnode === device || d.name === device);
		if (!info) throw new Error(`Pointer device not found: ${device}`);
		return new PointerDevice(info, options);
	}

	constructor(info: PointerDeviceInfo, options: PointerDeviceOptions = {}) {
		super();
		this.info = info;
		const rate = Number(this.readHardwareSetting("rate"));
		const nominal = options.nominalIntervalMs ?? (rate > 0 ? 1000 / rate : 10);
		this.options = {
			smoothingMs: options.smoothingMs ?? 30,
			nominalIntervalMs: nominal,
			idleResetMs: options.idleResetMs ?? nominal * 5,
			flattenXAccel: options.flattenXAccel ?? true,
		};
	}

	get name(): string {
		return this.info.name;
	}

	get isRunning(): boolean {
		return this.fd !== null;
	}

	/** Name of the virtual device created by enableCurve(). */
	get virtualDeviceName(): string {
		return this.info.name.slice(0, 79 - VIRTUAL_NAME_SUFFIX.length) + VIRTUAL_NAME_SUFFIX;
	}

	get isCurveEnabled(): boolean {
		return this.uinputFd !== null;
	}

	// --- reading ----------------------------------------------------------

	start(): void {
		if (this.fd !== null) return;
		try {
			this.fd = fs.openSync(this.info.devnode, "r");
		} catch (err: any) {
			if (err?.code === "EACCES") {
				throw new Error(
					`No permission to read ${this.info.devnode}. Add yourself to the 'input' group ` +
					`(sudo usermod -aG input $USER, then log out/in) or add a udev rule.`,
				);
			}
			throw err;
		}

		this.stream = fs.createReadStream(this.info.devnode, {
			fd: this.fd,
			highWaterMark: INPUT_EVENT_SIZE * 64,
			autoClose: true,
		});
		this.stream.on("data", (chunk: Buffer) => this.onData(chunk));
		this.stream.on("error", (err) => {
			this.teardown();
			this.emit("error", err);
		});
		this.emit("start");
	}

	stop(): void {
		if (this.fd === null) return;
		this.teardown();
	}

	private teardown(): void {
		this.disableCurve();
		const stream = this.stream;
		const fd = this.fd;
		this.stream = null;
		this.fd = null;
		this.pending = Buffer.alloc(0);
		this.frame = [];
		this.resetMotionState();
		stream?.removeAllListeners("data");
		stream?.removeAllListeners("error");
		stream?.on("error", () => {}); // the revoked read fails with ENODEV; expected
		// The stream's read is blocked in the thread pool until the device
		// produces an event, and Node waits for it on exit (so Quit would hang
		// until the stick moved). Revoking the fd makes that read return now.
		if (fd !== null) {
			try {
				ioctlValue(fd, EVIOCREVOKE, 0, "EVIOCREVOKE");
			} catch { /* already closed */ }
		}
		stream?.destroy();
		this.emit("stop");
	}

	private onData(chunk: Buffer): void {
		let buf = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
		let off = 0;
		for (; off + INPUT_EVENT_SIZE <= buf.length; off += INPUT_EVENT_SIZE) {
			this.onEvent(readInputEvent(buf, off));
		}
		this.pending = off < buf.length ? Buffer.from(buf.subarray(off)) : Buffer.alloc(0);
	}

	private onEvent(ev: InputEvent): void {
		this.emit("event", ev);

		if (ev.type === EV_SYN) {
			if (ev.code === SYN_DROPPED) {
				// Kernel buffer overrun: discard until the next SYN_REPORT.
				this.dropping = true;
				this.frame = [];
				return;
			}
			if (ev.code === SYN_REPORT) {
				const frame = this.frame;
				this.frame = [];
				if (this.dropping) {
					this.dropping = false;
					return;
				}
				this.onFrame(frame, ev.time);
			}
			return;
		}
		if (!this.dropping) this.frame.push(ev);
	}

	private onFrame(frame: InputEvent[], time: number): void {
		this.emit("frame", frame);

		let dx = 0;
		let dy = 0;
		const passthrough: InputEvent[] = [];
		for (const e of frame) {
			if (e.type === EV_REL && e.code === REL_X) dx += e.value;
			else if (e.type === EV_REL && e.code === REL_Y) dy += e.value;
			else passthrough.push(e);
		}

		let delta: DeltaEvent | null = null;
		if (dx !== 0 || dy !== 0) {
			delta = this.measure(dx, dy, time);
			this.emit("delta", delta);
		}

		if (this.uinputFd === null) return;

		const out: { type: number; code: number; value: number }[] = [...passthrough];
		if (delta) {
			const o = this.applyCurve(delta);
			if (o.outDx !== 0) out.push({ type: EV_REL, code: REL_X, value: o.outDx });
			if (o.outDy !== 0) out.push({ type: EV_REL, code: REL_Y, value: o.outDy });
			this.emit("output", o);
		}
		if (out.length === 0) return;
		out.push({ type: EV_SYN, code: SYN_REPORT, value: 0 });
		try {
			fs.writeSync(this.uinputFd, writeInputEvents(out));
		} catch (err: any) {
			this.emit("error", err);
		}
	}

	private resetMotionState(): void {
		this.history = [];
		this.remX = 0;
		this.remY = 0;
		this.lastMotionTime = -Infinity;
	}

	private measure(dx: number, dy: number, time: number): DeltaEvent {
		const { nominalIntervalMs: nominal, idleResetMs, smoothingMs } = this.options;
		const dist = Math.hypot(dx, dy);

		let dt = time - this.lastMotionTime;
		if (!(dt > 0) || dt > idleResetMs) {
			this.resetMotionState();
			dt = nominal;
		}
		this.lastMotionTime = time;

		// Velocity over a short window. history[0] may be an "anchor" entry
		// older than the window whose timestamp marks the window start.
		this.history.push({ time, dist });
		const cutoff = time - smoothingMs;
		while (this.history.length > 2 && this.history[1].time <= cutoff) this.history.shift();

		let sum = 0;
		let span: number;
		const first = this.history[0];
		if (this.history.length > 1 && first.time <= cutoff) {
			for (let i = 1; i < this.history.length; i++) sum += this.history[i].dist;
			span = time - first.time;
		} else {
			for (const h of this.history) sum += h.dist;
			span = time - first.time + nominal;
		}

		return {
			dx,
			dy,
			time,
			dt,
			rawSpeed: dist / dt,
			speed: sum / Math.max(span, 1e-3),
		};
	}

	private applyCurve(d: DeltaEvent): OutputEvent {
		const gain = this.curve ? this.curve.gainAt(d.speed) : 1;
		const fx = d.dx * gain * this.sensX + this.remX;
		const fy = d.dy * gain * this.sensY + this.remY;
		const outDx = Math.trunc(fx);
		const outDy = Math.trunc(fy);
		this.remX = fx - outDx;
		this.remY = fy - outDy;
		return { ...d, outDx, outDy, gain };
	}

	// --- curve ------------------------------------------------------------

	/** Current curve, or null for passthrough (gain 1). */
	getCurve(): AccelCurve | null {
		return this.curve;
	}

	/** Sets the curve. Takes effect immediately if the curve is enabled. */
	setCurve(curve: AccelCurve | null): void {
		this.curve = curve;
	}

	/** Shorthand: points[i] = output speed at input speed i * step (units/ms). */
	setCurvePoints(step: number, points: number[]): AccelCurve {
		const c = new AccelCurve(step, points);
		this.setCurve(c);
		return c;
	}

	/**
	 * Per-axis output multipliers applied after the curve (curve speed is
	 * still measured on the raw 2D motion). Takes effect immediately.
	 */
	setAxisSensitivity(x: number, y: number = x): void {
		this.sensX = x;
		this.sensY = y;
	}

	getAxisSensitivity(): { x: number; y: number } {
		return { x: this.sensX, y: this.sensY };
	}

	saveCurve(file: string): void {
		if (!this.curve) throw new Error("No curve set");
		fs.writeFileSync(file, JSON.stringify(this.curve.toJSON(), null, 2));
	}

	loadCurve(file: string): AccelCurve {
		const c = AccelCurve.fromJSON(fs.readFileSync(file, "utf8"));
		this.setCurve(c);
		return c;
	}

	/**
	 * Grabs the physical device exclusively and starts re-injecting motion
	 * (with the curve applied) through a virtual device. Starts reading if
	 * needed. Releasing happens on disableCurve()/stop() or process exit.
	 */
	enableCurve(curve?: AccelCurve): void {
		if (curve) this.setCurve(curve);
		if (this.uinputFd !== null) return;
		if (this.fd === null) this.start();
		const srcFd = this.fd!;

		let ufd: number;
		try {
			ufd = fs.openSync("/dev/uinput", "w");
		} catch (err: any) {
			throw new Error(`Cannot open /dev/uinput (${err?.code ?? err}). A udev rule granting access is needed.`);
		}

		const virtualName = this.virtualDeviceName;
		try {
			// Clone the source device's capabilities so libinput classifies the
			// virtual device the same way (pointing stick, buttons, wheel...).
			const evTypes = queryBits(srcFd, 0, EV_MAX);
			const copy = (type: number, max: number, setBit: number) => {
				if (!evTypes.includes(type)) return;
				ioctlValue(ufd, UI_SET_EVBIT, type, "UI_SET_EVBIT");
				for (const code of queryBits(srcFd, type, max)) ioctlValue(ufd, setBit, code, "UI_SET_*BIT");
			};
			copy(EV_KEY, KEY_MAX, UI_SET_KEYBIT);
			copy(EV_REL, REL_MAX, UI_SET_RELBIT);
			copy(EV_MSC, MSC_MAX, UI_SET_MSCBIT);
			for (const p of queryProps(srcFd)) ioctlValue(ufd, UI_SET_PROPBIT, p, "UI_SET_PROPBIT");

			const id = queryId(srcFd);
			ioctlBuffer(ufd, UI_DEV_SETUP, makeUinputSetup(virtualName, { ...id, bustype: BUS_VIRTUAL }), "UI_DEV_SETUP");
			ioctlValue(ufd, UI_DEV_CREATE, 0, "UI_DEV_CREATE");
			ioctlValue(srcFd, EVIOCGRAB, 1, "EVIOCGRAB");
		} catch (err) {
			try { ioctlValue(ufd, UI_DEV_DESTROY, 0); } catch { /* not created */ }
			fs.closeSync(ufd);
			throw err;
		}

		this.uinputFd = ufd;
		this.resetMotionState();
		if (this.options.flattenXAccel) flattenXInputAccel(virtualName);
		this.emit("remap-start");
	}

	/** Releases the grab and removes the virtual device. */
	disableCurve(): void {
		if (this.uinputFd === null) return;
		if (this.fd !== null) {
			try { ioctlValue(this.fd, EVIOCGRAB, 0, "EVIOCGRAB"); } catch { /* fd gone */ }
		}
		try { ioctlValue(this.uinputFd, UI_DEV_DESTROY, 0); } catch { /* ignore */ }
		try { fs.closeSync(this.uinputFd); } catch { /* ignore */ }
		this.uinputFd = null;
		this.emit("remap-stop");
	}

	// --- hardware (firmware) settings -------------------------------------

	/** sysfs directory holding driver attributes (e.g. .../i8042/serio1). */
	get hardwareDir(): string {
		return path.dirname(path.dirname(this.info.sysfs));
	}

	readHardwareSetting(name: string): string | null {
		try {
			return fs.readFileSync(path.join(this.hardwareDir, name), "utf8").trim();
		} catch {
			return null;
		}
	}

	/** Readable firmware-level settings (TrackPoint sensitivity, speed, inertia...). */
	getHardwareSettings(): Record<string, string> {
		const out: Record<string, string> = {};
		for (const a of HARDWARE_ATTRS) {
			const v = this.readHardwareSetting(a);
			if (v !== null) out[a] = v;
		}
		return out;
	}

	/** Writes a firmware setting. Usually requires root or a udev rule. */
	setHardwareSetting(name: string, value: string | number): void {
		if (!HARDWARE_ATTRS.includes(name)) throw new Error(`Unknown hardware setting ${name}`);
		fs.writeFileSync(path.join(this.hardwareDir, name), String(value));
	}
}

/**
 * Best-effort: set the virtual device to libinput's flat profile under X11.
 * The device takes a moment to appear in X, so retry briefly.
 */
export function flattenXInputAccel(deviceName: string): void {
	if (!process.env.DISPLAY) return;
	const target = `pointer:${deviceName}`;
	let attempts = 0;
	const tryOnce = () => {
		execFile("xinput", ["set-prop", target, "libinput Accel Profile Enabled", "0", "1"], (err) => {
			if (!err) {
				execFile("xinput", ["set-prop", target, "libinput Accel Speed", "0"], () => {});
				return;
			}
			if (++attempts < 15) setTimeout(tryOnce, 200);
		});
	};
	setTimeout(tryOnce, 100);
}
