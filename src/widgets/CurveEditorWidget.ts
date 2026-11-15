import {
	BrushStyle, CursorShape, PenStyle, QBrush, QColor, QFont, QFontMetrics, QMouseEvent, QPainter, QPainterPath,
	QPen, QWidget, RenderHint, WidgetEventTypes,
} from "@nodegui/nodegui";
import { CurvePoint, monotoneSpline } from "../curves/spline";
import { normalizePoints } from "../curves/CurveLibrary";
import { makeColor } from "../util/graphics";
import { currentTheme } from "../util/theme";

/** Colours follow the application palette (native light/dark look). */
function editorTheme() {
	const t = currentTheme();
	return {
		background: t.window,
		plot: t.base,
		border: t.border,
		gridMajor: t.gridMajor,
		gridMinor: t.gridMinor,
		text: t.mutedText,
		identity: t.accent.identity,
		curve: t.accent.curve,
		point: t.text,
		pointFixed: t.border,
		pointHover: t.accent.pointHover,
	};
}

const HIT_RADIUS = 10;
const MIN_GAP = 0.01; // minimum x distance between neighbouring points

/**
 * Interactive editor for a curve shape on the unit square.
 *  - drag a point to move it (the end points are fixed at (0,0) and (1,1))
 *  - double-click empty space to add a point
 *  - double-click or right-click a point to remove it
 * The curve is a monotone cubic through the points (same as at runtime).
 */
export default class CurveEditorWidget extends QWidget {
	private points: CurvePoint[] = [[0, 0], [1, 1]];
	private dragIndex = -1;
	private hoverIndex = -1;
	private listeners: ((points: CurvePoint[]) => void)[] = [];
	private colors = new Map<string, QColor>();
	private padding = { left: 40, right: 16, top: 16, bottom: 32 };

	constructor() {
		super();
		this.setObjectName("curve-editor");
		this.setMinimumSize(300, 300);
		this.setMouseTracking(true);
		this.addEventListener(WidgetEventTypes.Paint, () => this.paint());
		this.addEventListener(WidgetEventTypes.Resize, () => this.update());
		this.addEventListener(WidgetEventTypes.MouseButtonPress, (e) => this.onPress(new QMouseEvent(e as any)));
		this.addEventListener(WidgetEventTypes.MouseMove, (e) => this.onMove(new QMouseEvent(e as any)));
		this.addEventListener(WidgetEventTypes.MouseButtonRelease, () => this.onRelease());
		this.addEventListener(WidgetEventTypes.MouseButtonDblClick, (e) => this.onDoubleClick(new QMouseEvent(e as any)));
	}

	/** Called after every edit with the new points. */
	onChange(listener: (points: CurvePoint[]) => void): void {
		this.listeners.push(listener);
	}

	setPoints(points: CurvePoint[]): void {
		this.points = normalizePoints(points);
		this.dragIndex = this.hoverIndex = -1;
		this.update();
	}

	getPoints(): CurvePoint[] {
		return this.points.map((p) => [...p] as CurvePoint);
	}

	// --- geometry -----------------------------------------------------------

	private plotRect() {
		const p = this.padding;
		const size = Math.max(10, Math.min(this.width() - p.left - p.right, this.height() - p.top - p.bottom));
		const x = p.left + (this.width() - p.left - p.right - size) / 2;
		const y = p.top + (this.height() - p.top - p.bottom - size) / 2;
		return { x, y, size };
	}

	private toScreen([x, y]: CurvePoint): [number, number] {
		const r = this.plotRect();
		return [r.x + x * r.size, r.y + (1 - y) * r.size];
	}

	private toUnit(sx: number, sy: number): CurvePoint {
		const r = this.plotRect();
		const clamp = (v: number) => Math.min(1, Math.max(0, v));
		return [clamp((sx - r.x) / r.size), clamp(1 - (sy - r.y) / r.size)];
	}

	private hit(sx: number, sy: number): number {
		let best = -1;
		let bestD = HIT_RADIUS;
		this.points.forEach((p, i) => {
			const [px, py] = this.toScreen(p);
			const d = Math.hypot(px - sx, py - sy);
			if (d <= bestD) { best = i; bestD = d; }
		});
		return best;
	}

	private isFixed(i: number): boolean {
		return i === 0 || i === this.points.length - 1;
	}

	// --- mouse --------------------------------------------------------------

	private onPress(e: QMouseEvent): void {
		const i = this.hit(e.x(), e.y());
		if (e.button() === 2) { // right button: remove
			if (i >= 0 && !this.isFixed(i)) this.removePoint(i);
			return;
		}
		if (e.button() === 1 && i >= 0 && !this.isFixed(i)) {
			this.dragIndex = i;
			this.setCursor(CursorShape.ClosedHandCursor);
		}
	}

	private onMove(e: QMouseEvent): void {
		if (this.dragIndex >= 0) {
			const i = this.dragIndex;
			let [x, y] = this.toUnit(e.x(), e.y());
			x = Math.min(this.points[i + 1][0] - MIN_GAP, Math.max(this.points[i - 1][0] + MIN_GAP, x));
			this.points[i] = [x, y];
			this.update();
			this.emitChange();
			return;
		}
		const h = this.hit(e.x(), e.y());
		if (h !== this.hoverIndex) {
			this.hoverIndex = h;
			this.setCursor(h >= 0 && !this.isFixed(h) ? CursorShape.OpenHandCursor : CursorShape.ArrowCursor);
			this.update();
		}
	}

	private onRelease(): void {
		if (this.dragIndex >= 0) {
			this.dragIndex = -1;
			this.setCursor(CursorShape.OpenHandCursor);
		}
	}

	private onDoubleClick(e: QMouseEvent): void {
		const i = this.hit(e.x(), e.y());
		if (i >= 0) {
			if (!this.isFixed(i)) this.removePoint(i);
			return;
		}
		const [x, y] = this.toUnit(e.x(), e.y());
		if (x <= MIN_GAP || x >= 1 - MIN_GAP) return;
		if (this.points.some((p) => Math.abs(p[0] - x) < MIN_GAP)) return;
		this.points = normalizePoints([...this.points, [x, y]]);
		this.update();
		this.emitChange();
	}

	private removePoint(i: number): void {
		this.points.splice(i, 1);
		this.hoverIndex = -1;
		this.update();
		this.emitChange();
	}

	private emitChange(): void {
		const pts = this.getPoints();
		for (const l of this.listeners) l(pts);
	}

	// --- painting -----------------------------------------------------------

	private color(c: string): QColor {
		let q = this.colors.get(c);
		if (!q) { q = makeColor(c); this.colors.set(c, q); }
		return q;
	}

	private pen(color: string, width = 1, style = PenStyle.SolidLine): QPen {
		const p = new QPen();
		p.setColor(this.color(color));
		p.setWidth(width);
		p.setStyle(style);
		return p;
	}

	private paint(): void {
		const THEME = editorTheme();
		const painter = new QPainter(this);
		painter.setRenderHint(RenderHint.Antialiasing, true);
		painter.fillRect(0, 0, this.width(), this.height(), this.color(THEME.background));

		const r = this.plotRect();
		const font = new QFont("Sans", 9);
		const fm = new QFontMetrics(font);
		painter.setFont(font);
		painter.fillRect(r.x, r.y, r.size, r.size, this.color(THEME.plot));

		// grid: minor every 0.05, major every 0.25 with labels
		for (let i = 1; i < 20; i++) {
			const major = i % 5 === 0;
			painter.setPen(this.pen(major ? THEME.gridMajor : THEME.gridMinor));
			const v = (i / 20) * r.size;
			painter.drawLineF(r.x + v, r.y, r.x + v, r.y + r.size);
			painter.drawLineF(r.x, r.y + v, r.x + r.size, r.y + v);
		}
		painter.setPen(this.pen(THEME.text));
		for (let i = 0; i <= 4; i++) {
			const s = (i / 4).toFixed(2);
			const v = (i / 4) * r.size;
			painter.drawTextF(r.x + v - fm.horizontalAdvance(s) / 2, r.y + r.size + 4 + fm.ascent(), s);
			painter.drawTextF(r.x - 6 - fm.horizontalAdvance(s), r.y + r.size - v + fm.ascent() / 2 - 1, s);
		}

		// 1:1 reference
		painter.setPen(this.pen(THEME.identity, 1, PenStyle.DashLine));
		painter.drawLineF(r.x, r.y + r.size, r.x + r.size, r.y);

		// curve
		const f = monotoneSpline(this.points);
		const path = new QPainterPath();
		const N = 200;
		for (let i = 0; i <= N; i++) {
			const x = i / N;
			const y = Math.min(1, Math.max(0, f(x)));
			const [sx, sy] = this.toScreen([x, y]);
			if (i === 0) path.moveTo(sx, sy);
			else path.lineTo(sx, sy);
		}
		painter.strokePath(path, this.pen(THEME.curve, 2));

		// points
		const noPen = new QPen();
		noPen.setStyle(PenStyle.NoPen);
		this.points.forEach((p, i) => {
			const [sx, sy] = this.toScreen(p);
			const fixed = this.isFixed(i);
			const active = i === this.dragIndex || i === this.hoverIndex;
			const rad = active && !fixed ? 7 : 5;
			const brush = new QBrush();
			brush.setStyle(BrushStyle.SolidPattern);
			brush.setColor(this.color(fixed ? THEME.pointFixed : active ? THEME.pointHover : THEME.point));
			painter.setPen(noPen);
			painter.setBrush(brush);
			painter.drawEllipse(sx - rad, sy - rad, rad * 2, rad * 2);
		});
		painter.setBrush(new QBrush());

		// readout for the point being dragged/hovered
		const ai = this.dragIndex >= 0 ? this.dragIndex : this.hoverIndex;
		if (ai >= 0) {
			const [x, y] = this.points[ai];
			const s = `(${x.toFixed(3)}, ${y.toFixed(3)})`;
			const [sx, sy] = this.toScreen(this.points[ai]);
			painter.setPen(this.pen(THEME.pointHover));
			const tx = Math.min(sx + 10, this.width() - fm.horizontalAdvance(s) - 4);
			painter.drawTextF(tx, Math.max(fm.ascent() + 2, sy - 10), s);
		}

		painter.setPen(this.pen(THEME.border));
		painter.drawRectF(r.x, r.y, r.size, r.size);
		painter.end();
	}
}
