import {
    BrushStyle, PenStyle, QBrush, QColor, QFont, QFontMetrics, QPainter, QPainterPath, QPen, QWidget, RenderHint,
    WidgetEventTypes,
} from "@nodegui/nodegui";
import { makeColor, niceStep, stepFormat } from "../util/graphics";
import { currentTheme } from "../util/theme";
import { paintDimOverlay } from "../util/dim";

export interface NipplePreviewConfig {
    title?: string;
    subtitle?: string;
    /** Value at the outer edge (position magnitude 1). */
    maxValue?: number;
    /** Value between rings. Undefined = automatic. */
    ringStep?: number;
    /** Approximate ring count when ringStep is automatic. */
    targetRings?: number;
    /** Unlabelled rings between labelled ones (0 = none). */
    minorDivisions?: number;
    format?: (v: number) => string;
}

/** A highlighted ring at a value. */
export interface RingConfig {
    value: number;
    color: string;
    width?: number;
    lineStyle?: "solid" | "dash" | "dot";
    label?: string;
}

/** A dot drawn on the preview. x, y in [-1, 1] of maxValue, +y up. */
export interface NippleConfig {
    x: number;
    y: number;
    /** Defaults to the theme's input colour. */
    color?: string;
    radius?: number;
    /** Higher draws on top. */
    z?: number;
}

/** A shaded annulus between two values (from = 0 gives a disc). */
export interface ZoneConfig {
    from: number;
    to: number;
    /** Fill colour; use "#rrggbbaa" for transparency. */
    color: string;
}

const PEN_STYLES = { solid: PenStyle.SolidLine, dash: PenStyle.DashLine, dot: PenStyle.DotLine };

/** Colours follow the application palette (native light/dark look). */
function previewTheme() {
    const t = currentTheme();
    return {
        background: t.window,
        plotBackground: t.base,
        border: t.border,
        ringMajor: t.gridMajor,
        ringMinor: t.gridMinor,
        axis: t.zeroLine,
        text: t.mutedText,
        title: t.text,
        nipple: t.accent.input,
    };
}

/**
 * Top-down view of the stick: position (x, y) in [-1, 1] (+y up) is drawn
 * inside a circle whose edge is `maxValue`, with labelled concentric rings.
 */
export default class NipplePreviewWidget extends QWidget {
    private nipples = new Map<string, NippleConfig>();
    private noPen: QPen;
    private colors = new Map<string, QColor>();
    private rings = new Map<string, RingConfig>();
    private zones = new Map<string, ZoneConfig>();
    private dimmed: string | null = null;
    private config: Required<Omit<NipplePreviewConfig, "ringStep" | "format">> &
        Pick<NipplePreviewConfig, "ringStep" | "format">;

    public nippleRadiusPx: number = 10;
    public nipplePosX: number = 0;
    public nipplePosY: number = 0;
    public padding = 12;

    constructor(config: NipplePreviewConfig = {}) {
        super();
        this.config = {
            title: "Stick deflection",
            subtitle: "",
            maxValue: 1,
            targetRings: 6, // same as GraphWidget targetTicks so rings match grid lines
            minorDivisions: 1,
            ...config,
        };

        this.nipples.set("input", { x: 0, y: 0, z: 1 });

        this.noPen = new QPen();
        this.noPen.setStyle(PenStyle.NoPen);

        this.setObjectName("nipple-preview");
        this.setMinimumSize(200, 200);
        this.addEventListener(WidgetEventTypes.Paint, () => this.onPaint());
        this.addEventListener(WidgetEventTypes.Resize, () => this.update());
    }

    public configure(config: NipplePreviewConfig): void {
        Object.assign(this.config, config);
        this.update();
    }

    public setRing(id: string, ring: RingConfig | null): void {
        if (ring) this.rings.set(id, ring);
        else this.rings.delete(id);
        this.update();
    }

    public setZone(id: string, zone: ZoneConfig | null): void {
        if (zone) this.zones.set(id, zone);
        else this.zones.delete(id);
        this.update();
    }

    /** Adds/updates (or removes, with null) a dot. "input" is the default one. */
    public setNipple(id: string, nipple: Partial<NippleConfig> | null): void {
        if (!nipple) this.nipples.delete(id);
        else {
            const prev = this.nipples.get(id);
            this.nipples.set(id, { x: 0, y: 0, ...prev, ...nipple });
        }
        this.update();
    }

    public getNipple(id: string): NippleConfig | undefined {
        return this.nipples.get(id);
    }

    /** Moves the default "input" dot. */
    /** Greys the preview out with a message, or restores it with null. */
    public setDimmed(message: string | null): void {
        if (message === this.dimmed) return;
        this.dimmed = message;
        this.update();
    }

    public setPosition(x: number, y: number): void {
        this.nipplePosX = x;
        this.nipplePosY = y;
        this.setNipple("input", { x, y });
    }

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

    private onPaint(): void {
        const THEME = previewTheme();
        const c = this.config;
        const painter = new QPainter(this);
        painter.setRenderHint(RenderHint.Antialiasing, true);

        const w = this.width();
        const h = this.height();
        painter.fillRect(0, 0, w, h, this.color(THEME.background));

        const font = new QFont("Sans", 9);
        const titleFont = new QFont("Sans", 12);
        titleFont.setBold(true);
        const fm = new QFontMetrics(font);
        const tfm = new QFontMetrics(titleFont);

        // --- title (same layout as GraphWidget so the two line up)
        let top = this.padding;
        if (c.title) {
            painter.setFont(titleFont);
            painter.setPen(this.pen(THEME.title));
            painter.drawText((w - tfm.horizontalAdvance(c.title)) / 2, top + tfm.ascent(), c.title);
            top += tfm.height();
        }
        if (c.subtitle) {
            painter.setFont(font);
            painter.setPen(this.pen(THEME.text));
            painter.drawText((w - fm.horizontalAdvance(c.subtitle)) / 2, top + fm.ascent(), c.subtitle);
            top += fm.height();
        }
        if (c.title || c.subtitle) top += 6;

        // --- circular plot area
        const R = Math.min(w - 2 * this.padding, h - top - this.padding) / 2;
        if (R < 10) { painter.end(); return; }
        const cx = w / 2;
        const cy = top + (h - top - this.padding) / 2;

        painter.setPen(this.noPen);
        const bg = new QBrush();
        bg.setStyle(BrushStyle.SolidPattern);
        bg.setColor(this.color(THEME.plotBackground));
        painter.setBrush(bg);
        painter.drawEllipse(cx - R, cy - R, 2 * R, 2 * R);
        painter.setBrush(new QBrush());

        const max = c.maxValue > 0 ? c.maxValue : 1;
        const step = c.ringStep ?? niceStep(max, c.targetRings);
        const fmt = c.format ?? stepFormat(step);
        const rad = (v: number) => (v / max) * R;
        const ring = (v: number) => painter.drawEllipse(cx - rad(v), cy - rad(v), 2 * rad(v), 2 * rad(v));

        // zones (under the grid)
        painter.setPen(this.noPen);
        for (const z of this.zones.values()) {
            const a = Math.max(0, Math.min(z.from, z.to, max));
            const b = Math.min(max, Math.max(z.from, z.to));
            if (b <= a) continue;
            const path = new QPainterPath();
            path.addEllipse(cx - rad(b), cy - rad(b), 2 * rad(b), 2 * rad(b));
            if (a > 0) path.addEllipse(cx - rad(a), cy - rad(a), 2 * rad(a), 2 * rad(a)); // odd-even fill -> hole
            const brush = new QBrush();
            brush.setStyle(BrushStyle.SolidPattern);
            brush.setColor(this.color(z.color));
            painter.setBrush(brush);
            painter.drawPath(path);
        }
        painter.setBrush(new QBrush());

        // minor rings
        if (c.minorDivisions > 0) {
            painter.setPen(this.pen(THEME.ringMinor));
            const ms = step / (c.minorDivisions + 1);
            for (let i = 1; i * ms < max - 1e-9; i++) {
                if (i % (c.minorDivisions + 1) !== 0) ring(i * ms);
            }
        }

        // crosshair
        painter.setPen(this.pen(THEME.axis));
        painter.drawLineF(cx - R, cy, cx + R, cy);
        painter.drawLineF(cx, cy - R, cx, cy + R);

        // major rings + labels (along the 45° diagonal, upper right)
        const majors: number[] = [];
        for (let i = 1; i * step < max - step * 1e-6; i++) majors.push(i * step);
        painter.setPen(this.pen(THEME.ringMajor));
        majors.forEach(ring);

        painter.setPen(this.pen(THEME.border));
        ring(max);

        painter.setFont(font);
        painter.setPen(this.pen(THEME.text));
        const diag = Math.SQRT1_2;
        for (const v of [...majors, max]) {
            const s = fmt(v);
            const r = rad(v);
            // skip a label that would collide with the edge label
            if (v !== max && (rad(max) - r) * diag < fm.height()) continue;
            painter.drawTextF(cx + r * diag + 3, cy - r * diag - 3, s);
        }

        // highlighted rings, labelled along the lower-right diagonal
        for (const r of this.rings.values()) {
            if (r.value <= 0 || r.value > max) continue;
            painter.setPen(this.pen(r.color, r.width ?? 2, r.lineStyle ?? "solid"));
            ring(r.value);
            if (r.label) {
                painter.setPen(this.pen(r.color));
                const rr = rad(r.value);
                // keep the label inside the widget
                const lx = Math.min(cx + rr * diag + 4, w - fm.horizontalAdvance(r.label) - 4);
                painter.drawTextF(lx, cy + rr * diag + fm.ascent(), r.label);
            }
        }

        // --- nipples, lowest z first
        painter.setPen(this.noPen);
        const sorted = [...this.nipples.values()].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
        for (const n of sorted) {
            let px = n.x;
            let py = n.y;
            const mag = Math.hypot(px, py);
            if (mag > 1) { px /= mag; py /= mag; }
            const nr = n.radius ?? this.nippleRadiusPx;
            const brush = new QBrush();
            brush.setStyle(BrushStyle.SolidPattern);
            brush.setColor(this.color(n.color ?? THEME.nipple));
            painter.setBrush(brush);
            painter.drawEllipse(cx + px * R - nr, cy - py * R - nr, nr * 2, nr * 2);
        }

        if (this.dimmed) paintDimOverlay(painter, w, h, this.dimmed);
        painter.end();
    }
}
