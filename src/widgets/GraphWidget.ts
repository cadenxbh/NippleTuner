import {
	BrushStyle, PenStyle, QBrush, QColor, QFont, QFontMetrics, QPainter, QPainterPath, QPen, QWidget,
	RenderHint, WidgetEventTypes,
} from "@nodegui/nodegui";
import { makeColor, niceStep, stepFormat } from "../util/graphics";
import { currentTheme } from "../util/theme";
import { paintDimOverlay } from "../util/dim";

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------
export interface AxisConfig {
	/** Axis title shown along the axis. */
	label?: string;
	/** Fixed range. Leave undefined to auto-fit the data (rounded to ticks). */
	min?: number;
	max?: number;
	/** Distance between labelled grid lines. Undefined = automatic "nice" step. */
	majorStep?: number;
	/** Approximate number of major lines when majorStep is automatic. */
	targetTicks?: number;
	/** Unlabelled grid lines between major lines (0 = none). */
	minorDivisions?: number;
	showGrid?: boolean;
	showTickLabels?: boolean;
	format?: (value: number) => string;
}

export interface GraphTheme {
	background: string;
	plotBackground: string;
	border: string;
	gridMajor: string;
	gridMinor: string;
	zeroLine: string;
	text: string;
	title: string;
}

export interface GraphConfig {
	title?: string;
	subtitle?: string;
	x?: AxisConfig;
	y?: AxisConfig;
	theme?: Partial<GraphTheme>;
	fontFamily?: string;
	fontSize?: number;
	titleSize?: number;
	/** Outer padding in px. */
	padding?: number;
	showLegend?: boolean;
	/** Force the plot area to be square (1 x unit == 1 y unit is NOT implied). */
	squarePlot?: boolean;
	minWidth?: number;
	minHeight?: number;
}

export type Point = [number, number];

export interface SeriesConfig {
	points: Point[];
	label?: string;
	color?: string;
	width?: number;
	style?: "line" | "points" | "both";
	lineStyle?: "solid" | "dash" | "dot";
	pointRadius?: number;
	/** Draw order; higher is on top. */
	z?: number;
}

/** A full-height (axis "x") or full-width (axis "y") reference line. */
export interface MarkerConfig {
	axis: "x" | "y";
	value: number;
	color?: string;
	width?: number;
	lineStyle?: "solid" | "dash" | "dot";
	label?: string;
}

/** A shaded band across the plot between two values on one axis. */
export interface RegionConfig {
	axis: "x" | "y";
	from: number;
	to: number;
	/** Fill colour; use "#rrggbbaa" for transparency. */
	color: string;
	label?: string;
}

/** A single highlighted point. */
export interface DotConfig {
	x: number;
	y: number;
	color?: string;
	radius?: number;
	label?: string;
}

/** Default colours follow the application palette (native light/dark look). */
function paletteTheme(): GraphTheme {
	const t = currentTheme();
	return {
		background: t.window,
		plotBackground: t.base,
		border: t.border,
		gridMajor: t.gridMajor,
		gridMinor: t.gridMinor,
		zeroLine: t.zeroLine,
		text: t.mutedText,
		title: t.text,
	};
}

const PALETTE = ["#89b4fa", "#f38ba8", "#a6e3a1", "#fab387", "#cba6f7", "#94e2d5", "#f9e2af"];

const PEN_STYLES = { solid: PenStyle.SolidLine, dash: PenStyle.DashLine, dot: PenStyle.DotLine };

interface Range { min: number; max: number; step: number }
interface Rect { x: number; y: number; w: number; h: number }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Liang–Barsky: clips segment to rect, returns null if fully outside. */
function clipSegment(x0: number, y0: number, x1: number, y1: number, r: Rect): [number, number, number, number] | null {
	let t0 = 0, t1 = 1;
	const dx = x1 - x0, dy = y1 - y0;
	const p = [-dx, dx, -dy, dy];
	const q = [x0 - r.x, r.x + r.w - x0, y0 - r.y, r.y + r.h - y0];
	for (let i = 0; i < 4; i++) {
		if (p[i] === 0) {
			if (q[i] < 0) return null;
		} else {
			const t = q[i] / p[i];
			if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
			else { if (t < t0) return null; if (t < t1) t1 = t; }
		}
	}
	return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------
/**
 * General-purpose 2D line/point graph with title, axis labels, major/minor
 * grid lines, legend, reference markers and highlighted dots. Everything is
 * configurable at runtime; every setter triggers a repaint.
 */
export default class GraphWidget extends QWidget {
	private config: Required<Omit<GraphConfig, "x" | "y" | "theme" | "subtitle">> & {
		subtitle?: string;
		x: AxisConfig;
		y: AxisConfig;
		/** Overrides on top of the palette-derived colours. */
		theme: Partial<GraphTheme>;
	};
	private series = new Map<string, SeriesConfig>();
	private markers = new Map<string, MarkerConfig>();
	private regions = new Map<string, RegionConfig>();
	private dots = new Map<string, DotConfig>();
	private colors = new Map<string, QColor>();
	private paintTheme: GraphTheme = paletteTheme();
	private dimmed: string | null = null;

	constructor(config: GraphConfig = {}) {
		super();
		this.setObjectName("graph");
		this.config = {
			title: "",
			fontFamily: "Sans",
			fontSize: 9,
			titleSize: 12,
			padding: 12,
			showLegend: true,
			squarePlot: false,
			minWidth: 200,
			minHeight: 150,
			...config,
			x: { targetTicks: 6, minorDivisions: 1, showGrid: true, showTickLabels: true, ...config.x },
			y: { targetTicks: 6, minorDivisions: 1, showGrid: true, showTickLabels: true, ...config.y },
			theme: { ...config.theme },
		};
		this.setMinimumSize(this.config.minWidth, this.config.minHeight);
		this.addEventListener(WidgetEventTypes.Paint, () => this.paint());
		this.addEventListener(WidgetEventTypes.Resize, () => this.update());
	}

	// --- configuration ----------------------------------------------------

	configure(config: GraphConfig): void {
		const { x, y, theme, ...rest } = config;
		Object.assign(this.config, rest);
		if (x) Object.assign(this.config.x, x);
		if (y) Object.assign(this.config.y, y);
		if (theme) Object.assign(this.config.theme, theme);
		if (rest.minWidth !== undefined || rest.minHeight !== undefined) {
			this.setMinimumSize(this.config.minWidth, this.config.minHeight);
		}
		this.update();
	}

	setTitle(title: string, subtitle?: string): void {
		this.configure({ title, subtitle });
	}

	setXAxis(axis: AxisConfig): void {
		this.configure({ x: axis });
	}

	setYAxis(axis: AxisConfig): void {
		this.configure({ y: axis });
	}

	// --- data -------------------------------------------------------------

	setSeries(id: string, series: SeriesConfig): void {
		const existing = this.series.get(id);
		this.series.set(id, {
			color: existing?.color ?? PALETTE[this.series.size % PALETTE.length],
			width: 2,
			style: "line",
			lineStyle: "solid",
			pointRadius: 3,
			z: 0,
			...existing,
			...series,
		});
		this.update();
	}

	/** Samples fn over [from, to] (defaults to the current x range). */
	setSeriesFunction(
		id: string,
		fn: (x: number) => number,
		opts: Omit<SeriesConfig, "points"> & { from?: number; to?: number; samples?: number } = {},
	): void {
		const { from, to, samples = 200, ...rest } = opts;
		const xr = this.computeRange("x");
		const a = from ?? xr.min;
		const b = to ?? xr.max;
		const points: Point[] = [];
		for (let i = 0; i <= samples; i++) {
			const x = a + ((b - a) * i) / samples;
			points.push([x, fn(x)]);
		}
		this.setSeries(id, { ...rest, points });
	}

	getSeries(id: string): SeriesConfig | undefined {
		return this.series.get(id);
	}

	removeSeries(id: string): void {
		if (this.series.delete(id)) this.update();
	}

	clearSeries(): void {
		this.series.clear();
		this.update();
	}

	setMarker(id: string, marker: MarkerConfig | null): void {
		if (marker) this.markers.set(id, marker);
		else this.markers.delete(id);
		this.update();
	}

	setRegion(id: string, region: RegionConfig | null): void {
		if (region) this.regions.set(id, region);
		else this.regions.delete(id);
		this.update();
	}

	/**
	 * Greys the graph out with a message (e.g. "Paused"), or restores it
	 * with null.
	 */
	setDimmed(message: string | null): void {
		if (message === this.dimmed) return;
		this.dimmed = message;
		this.update();
	}

	setDot(id: string, dot: DotConfig | null): void {
		if (dot) this.dots.set(id, dot);
		else this.dots.delete(id);
		this.update();
	}

	// --- range ------------------------------------------------------------

	private computeRange(axis: "x" | "y"): Range {
		const cfg = this.config[axis];
		let lo = cfg.min;
		let hi = cfg.max;
		if (lo === undefined || hi === undefined) {
			let dmin = Infinity, dmax = -Infinity;
			const idx = axis === "x" ? 0 : 1;
			for (const s of this.series.values()) {
				for (const p of s.points) {
					if (isFinite(p[idx])) {
						dmin = Math.min(dmin, p[idx]);
						dmax = Math.max(dmax, p[idx]);
					}
				}
			}
			if (!isFinite(dmin)) { dmin = 0; dmax = 1; }
			if (dmin === dmax) { dmin -= 0.5; dmax += 0.5; }
			const step = cfg.majorStep ?? niceStep(dmax - dmin, cfg.targetTicks ?? 6);
			lo = lo ?? Math.floor(dmin / step + 1e-9) * step;
			hi = hi ?? Math.ceil(dmax / step - 1e-9) * step;
		}
		if (hi <= lo) hi = lo + 1;
		const step = cfg.majorStep ?? niceStep(hi - lo, cfg.targetTicks ?? 6);
		return { min: lo, max: hi, step };
	}

	private ticks(r: Range): number[] {
		const out: number[] = [];
		const start = Math.ceil(r.min / r.step - 1e-9);
		for (let i = start; i * r.step <= r.max + r.step * 1e-9; i++) out.push(i * r.step);
		return out;
	}

	// --- painting ---------------------------------------------------------

	private color(c: string): QColor {
		let q = this.colors.get(c);
		if (!q) { q = makeColor(c); this.colors.set(c, q); }
		return q;
	}

	private pen(color: string, width = 1, style: keyof typeof PEN_STYLES = "solid"): QPen {
		const p = new QPen();
		p.setColor(this.color(color));
		p.setWidth(width);
		p.setStyle(PEN_STYLES[style]);
		return p;
	}

	private paint(): void {
		const c = this.config;
		const t: GraphTheme = { ...paletteTheme(), ...c.theme };
		this.paintTheme = t;
		const W = this.width();
		const H = this.height();
		const painter = new QPainter(this);
		painter.setRenderHint(RenderHint.Antialiasing, true);

		const font = new QFont(c.fontFamily, c.fontSize);
		const titleFont = new QFont(c.fontFamily, c.titleSize);
		titleFont.setBold(true);
		const fm = new QFontMetrics(font);
		const tfm = new QFontMetrics(titleFont);
		const lineH = fm.height();

		painter.fillRect(0, 0, W, H, this.color(t.background));

		const xr = this.computeRange("x");
		const yr = this.computeRange("y");
		const xFmt = c.x.format ?? stepFormat(xr.step);
		const yFmt = c.y.format ?? stepFormat(yr.step);
		const xTicks = this.ticks(xr);
		const yTicks = this.ticks(yr);

		// --- layout
		let top = c.padding;
		if (c.title) top += tfm.height();
		if (c.subtitle) top += lineH;
		if (c.title || c.subtitle) top += 6;

		let left = c.padding;
		if (c.y.label) left += lineH + 4;
		if (c.y.showTickLabels) left += Math.max(0, ...yTicks.map((v) => fm.horizontalAdvance(yFmt(v)))) + 6;

		let bottom = c.padding;
		if (c.x.showTickLabels) bottom += lineH + 4;
		if (c.x.label) bottom += lineH + 2;

		const right = c.padding + (c.x.showTickLabels ? fm.horizontalAdvance(xFmt(xr.max)) / 2 : 0);

		let plot: Rect = { x: left, y: top, w: W - left - right, h: H - top - bottom };
		if (c.squarePlot) {
			const s = Math.min(plot.w, plot.h);
			plot = { x: plot.x + (plot.w - s) / 2, y: plot.y + (plot.h - s) / 2, w: s, h: s };
		}
		if (plot.w < 10 || plot.h < 10) { painter.end(); return; }

		const sx = (v: number) => plot.x + ((v - xr.min) / (xr.max - xr.min)) * plot.w;
		const sy = (v: number) => plot.y + plot.h - ((v - yr.min) / (yr.max - yr.min)) * plot.h;

		// --- title
		if (c.title) {
			painter.setFont(titleFont);
			painter.setPen(this.pen(t.title));
			painter.drawText((W - tfm.horizontalAdvance(c.title)) / 2, c.padding + tfm.ascent(), c.title);
		}
		if (c.subtitle) {
			painter.setFont(font);
			painter.setPen(this.pen(t.text));
			const y0 = c.padding + (c.title ? tfm.height() : 0) + fm.ascent();
			painter.drawText((W - fm.horizontalAdvance(c.subtitle)) / 2, y0, c.subtitle);
		}

		// --- plot background + grid
		painter.fillRect(plot.x, plot.y, plot.w, plot.h, this.color(t.plotBackground));

		const drawGrid = (axis: "x" | "y", r: Range, ticks: number[], cfg: AxisConfig) => {
			if (!cfg.showGrid) return;
			const line = (v: number) => {
				if (axis === "x") painter.drawLineF(sx(v), plot.y, sx(v), plot.y + plot.h);
				else painter.drawLineF(plot.x, sy(v), plot.x + plot.w, sy(v));
			};
			const minor = cfg.minorDivisions ?? 0;
			if (minor > 0) {
				painter.setPen(this.pen(t.gridMinor));
				const ms = r.step / (minor + 1);
				const first = Math.ceil(r.min / ms - 1e-9);
				for (let i = first; i * ms <= r.max + 1e-9; i++) {
					if (i % (minor + 1) !== 0) line(i * ms);
				}
			}
			painter.setPen(this.pen(t.gridMajor));
			ticks.forEach(line);
			if (r.min < 0 && r.max > 0) {
				painter.setPen(this.pen(t.zeroLine));
				line(0);
			}
		};
		drawGrid("x", xr, xTicks, c.x);
		drawGrid("y", yr, yTicks, c.y);

		// --- tick labels
		painter.setFont(font);
		painter.setPen(this.pen(t.text));
		if (c.x.showTickLabels) {
			for (const v of xTicks) {
				const s = xFmt(v);
				painter.drawTextF(sx(v) - fm.horizontalAdvance(s) / 2, plot.y + plot.h + 4 + fm.ascent(), s);
			}
		}
		if (c.y.showTickLabels) {
			for (const v of yTicks) {
				const s = yFmt(v);
				painter.drawTextF(plot.x - 6 - fm.horizontalAdvance(s), sy(v) + fm.ascent() / 2 - 1, s);
			}
		}

		// --- axis labels
		if (c.x.label) {
			const yb = H - c.padding - fm.descent();
			painter.drawTextF(plot.x + (plot.w - fm.horizontalAdvance(c.x.label)) / 2, yb, c.x.label);
		}
		if (c.y.label) {
			painter.save();
			painter.translate(c.padding + fm.ascent(), plot.y + (plot.h + fm.horizontalAdvance(c.y.label)) / 2);
			painter.rotate(-90);
			painter.drawText(0, 0, c.y.label);
			painter.restore();
		}

		// --- regions (under markers and data)
		for (const r of this.regions.values()) {
			const range = r.axis === "x" ? xr : yr;
			const a = Math.max(range.min, Math.min(r.from, r.to));
			const b = Math.min(range.max, Math.max(r.from, r.to));
			if (b <= a) continue;
			if (r.axis === "x") {
				painter.fillRectF(sx(a), plot.y, sx(b) - sx(a), plot.h, this.color(r.color));
				if (r.label) {
					painter.setPen(this.pen(t.text));
					const lw = fm.horizontalAdvance(r.label);
					if (lw + 8 < sx(b) - sx(a)) {
						painter.drawTextF((sx(a) + sx(b) - lw) / 2, plot.y + plot.h - 6, r.label);
					}
				}
			} else {
				painter.fillRectF(plot.x, sy(b), plot.w, sy(a) - sy(b), this.color(r.color));
				if (r.label) {
					painter.setPen(this.pen(t.text));
					painter.drawTextF(plot.x + 6, (sy(a) + sy(b) + fm.ascent()) / 2, r.label);
				}
			}
		}

		// --- markers
		for (const m of this.markers.values()) {
			const col = m.color ?? t.text;
			painter.setPen(this.pen(col, m.width ?? 1, m.lineStyle ?? "dash"));
			if (m.axis === "x") {
				if (m.value < xr.min || m.value > xr.max) continue;
				painter.drawLineF(sx(m.value), plot.y, sx(m.value), plot.y + plot.h);
				if (m.label) painter.drawTextF(sx(m.value) + 4, plot.y + fm.ascent() + 2, m.label);
			} else {
				if (m.value < yr.min || m.value > yr.max) continue;
				painter.drawLineF(plot.x, sy(m.value), plot.x + plot.w, sy(m.value));
				if (m.label) painter.drawTextF(plot.x + 4, sy(m.value) - 4, m.label);
			}
		}

		// --- series
		const sorted = [...this.series.values()].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
		for (const s of sorted) {
			const col = s.color!;
			if (s.style !== "points" && s.points.length > 1) {
				const path = new QPainterPath();
				let penDown = false;
				for (let i = 1; i < s.points.length; i++) {
					const [ax, ay] = s.points[i - 1];
					const [bx, by] = s.points[i];
					if (![ax, ay, bx, by].every(isFinite)) { penDown = false; continue; }
					const seg = clipSegment(sx(ax), sy(ay), sx(bx), sy(by), plot);
					if (!seg) { penDown = false; continue; }
					if (!penDown) path.moveTo(seg[0], seg[1]);
					path.lineTo(seg[2], seg[3]);
					// Re-start the path if the segment was clipped at its end.
					penDown = seg[2] === sx(bx) && seg[3] === sy(by);
				}
				painter.strokePath(path, this.pen(col, s.width, s.lineStyle));
			}
			if (s.style !== "line") {
				this.drawDots(painter, s.points.map(([x, y]) => ({ x, y, color: col, radius: s.pointRadius })), sx, sy, plot);
			}
		}

		// --- dots
		this.drawDots(painter, [...this.dots.values()], sx, sy, plot, fm);

		// --- border
		painter.setPen(this.pen(t.border));
		painter.setBrush(new QBrush());
		painter.drawRectF(plot.x, plot.y, plot.w, plot.h);

		// --- legend
		const labelled = sorted.filter((s) => s.label);
		if (c.showLegend && labelled.length) {
			const sw = 16;
			const lw = Math.max(...labelled.map((s) => fm.horizontalAdvance(s.label!))) + sw + 18;
			const lh = labelled.length * lineH + 8;
			const lx = plot.x + plot.w - lw - 6;
			const ly = plot.y + 6;
			painter.fillRect(lx, ly, lw, lh, this.color(t.background));
			painter.setPen(this.pen(t.border));
			painter.drawRectF(lx, ly, lw, lh);
			labelled.forEach((s, i) => {
				const yy = ly + 4 + i * lineH + lineH / 2;
				painter.setPen(this.pen(s.color!, s.width, s.lineStyle));
				painter.drawLineF(lx + 6, yy, lx + 6 + sw, yy);
				painter.setPen(this.pen(t.text));
				painter.drawTextF(lx + sw + 12, yy + fm.ascent() / 2 - 1, s.label!);
			});
		}

		if (this.dimmed) paintDimOverlay(painter, W, H, this.dimmed);
		painter.end();
	}

	private drawDots(
		painter: QPainter,
		dots: DotConfig[],
		sx: (v: number) => number,
		sy: (v: number) => number,
		plot: Rect,
		fm?: QFontMetrics,
	): void {
		for (const d of dots) {
			const x = sx(d.x), y = sy(d.y);
			if (x < plot.x - 1 || x > plot.x + plot.w + 1 || y < plot.y - 1 || y > plot.y + plot.h + 1) continue;
			const r = d.radius ?? 4;
			const brush = new QBrush();
			brush.setStyle(BrushStyle.SolidPattern);
			brush.setColor(this.color(d.color ?? "#ffffff"));
			const noPen = new QPen();
			noPen.setStyle(PenStyle.NoPen);
			painter.setPen(noPen);
			painter.setBrush(brush);
			painter.drawEllipse(x - r, y - r, r * 2, r * 2);
			if (d.label && fm) {
				painter.setPen(this.pen(this.paintTheme.title));
				painter.drawTextF(x + r + 4, y - r - 2, d.label);
			}
		}
		painter.setBrush(new QBrush());
	}
}
