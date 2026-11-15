import { DeltaEvent, PointerDevice } from "../pointer";
import GraphWidget from "../widgets/GraphWidget";
import NipplePreviewWidget from "../widgets/NipplePreviewWidget";
import { SMOOTHING_MS } from "./constants";
import { currentTheme } from "../util/theme";
import StickRange from "./StickRange";
import { Tuning } from "./tuning";

const TICK_MS = 8;

/**
 * Live stick display: the input dot and tuned-output dot on the preview, and
 * the "you are here" marker on the curve graph.
 *
 * Smoothing (display only — the device has its own speed estimate):
 *  Stage 1: leaky integrator of the raw counts → continuous rate estimate in
 *           counts per report. Missing reports (light pushes, release) count
 *           as zero, so it settles between grid steps and falls to 0 itself.
 *  Stage 2: (render tick) a second identical low-pass that removes the
 *           sawtooth stage 1 has between reports.
 */
export default class LiveView {
	private gain: number;
	private rx = 0;
	private ry = 0;
	private rt = performance.now();
	private px = 0;
	private py = 0;
	private pt = this.rt;
	private lastDotKey = "";
	private lastNippleKey = "";
	/** The speed the curve is evaluated at (PointerDevice's own estimate). */
	private curveSpeed = 0;
	private lastDeltaAt = -Infinity;
	private timer: NodeJS.Timeout | null = null;
	private paused = false;
	private readonly onDeltaBound = (d: DeltaEvent) => this.onDelta(d);
	private readonly onErrorBound = (err: Error) => console.error("Pointer device error:", err.message);

	constructor(
		private tp: PointerDevice | null,
		private range: StickRange,
		private preview: NipplePreviewWidget,
		private graph: GraphWidget,
		/** Current tuning shown in the window, and the views' display range. */
		private view: () => { tuning: Tuning; displayMax: number },
	) {
		this.gain = 1 - Math.exp(-range.interval / SMOOTHING_MS); // steady state == raw rate
	}

	start(): void {
		this.attach();
		this.timer = setInterval(() => this.tick(), TICK_MS);
	}

	/** Follows a different device (Preferences → Device). */
	setDevice(tp: PointerDevice | null): void {
		this.tp?.off("delta", this.onDeltaBound);
		this.tp?.off("error", this.onErrorBound);
		this.tp = tp;
		this.gain = 1 - Math.exp(-this.range.interval / SMOOTHING_MS);
		this.rx = this.ry = this.px = this.py = 0;
		this.curveSpeed = 0;
		this.lastDeltaAt = -Infinity;
		this.lastNippleKey = this.lastDotKey = "\u0000"; // force a redraw
		if (this.timer) this.attach();
	}

	private attach(): void {
		this.tp?.on("delta", this.onDeltaBound);
		this.tp?.on("error", this.onErrorBound);
	}

	/** While paused the dots aren't redrawn (input is still tracked). */
	setPaused(paused: boolean): void {
		if (paused === this.paused) return;
		this.paused = paused;
		if (!paused) this.lastNippleKey = this.lastDotKey = "\u0000"; // force a redraw
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	private decayTo(now: number): void {
		const k = Math.exp(-(now - this.rt) / SMOOTHING_MS);
		this.rx *= k;
		this.ry *= k;
		this.rt = now;
	}

	private onDelta(d: DeltaEvent): void {
		const now = performance.now();
		this.curveSpeed = d.speed;
		this.lastDeltaAt = now;
		this.decayTo(now);
		this.rx += d.dx * this.gain;
		this.ry += d.dy * this.gain;
	}

	private tick(): void {
		const now = performance.now();
		this.decayTo(now);
		const a = 1 - Math.exp(-(now - this.pt) / SMOOTHING_MS);
		this.pt = now;
		this.px += (this.rx - this.px) * a;
		this.py += (this.ry - this.py) * a;

		const { px, py } = this;
		const mag = Math.hypot(px, py);
		this.range.observe(mag); // may grow the range (and re-render)
		if (this.paused) return;

		const { tuning, displayMax } = this.view();
		const COLORS = currentTheme().accent;
		const { curve, sens } = tuning;
		const interval = this.range.interval;

		// Input velocity (counts/ms). evdev +y is down, the preview's +y is up.
		const vx = px / interval;
		const vy = py / interval;
		const speed = mag / interval;

		// Tuned output: same direction, scaled by the curve's gain and the
		// per-axis sensitivity, exactly as PointerDevice applies it.
		const g = speed > 0 ? curve.gainAt(speed) : 1;
		const tx = vx * g * sens.x;
		const ty = vy * g * sens.y;

		const nipKey = [vx, vy, tx, ty, displayMax].map((v) => v.toFixed(3)).join();
		if (nipKey !== this.lastNippleKey) {
			this.lastNippleKey = nipKey;
			this.preview.setNipple("input", { x: vx / displayMax, y: -vy / displayMax, z: 1 });
			this.preview.setNipple("tuned", { x: tx / displayMax, y: -ty / displayMax, color: COLORS.tuned, z: 0 });
		}

		// Live position on the curve graph, using the device's own speed.
		const idleMs = this.tp?.options.idleResetMs ?? 50;
		const cs = now - this.lastDeltaAt > idleMs ? 0 : this.curveSpeed;
		// Output speed along the current direction (per-axis sensitivity).
		const dirScale = mag > 0 ? Math.hypot((px / mag) * sens.x, (py / mag) * sens.y) : sens.x;
		const out = curve.evaluate(cs) * dirScale;
		const dotKey = cs < this.range.maxSpeed * 1e-3 ? "" : `${cs.toFixed(3)},${out.toFixed(3)}`;
		if (dotKey !== this.lastDotKey) {
			this.lastDotKey = dotKey;
			if (!dotKey) {
				this.graph.setMarker("input", null);
				this.graph.setDot("input", null);
			} else {
				this.graph.setMarker("input", { axis: "x", value: cs, color: COLORS.liveInput });
				this.graph.setDot("input", { x: cs, y: out, color: COLORS.liveInput, radius: 5, label: `${cs.toFixed(1)} → ${out.toFixed(1)}` });
			}
		}
	}
}
