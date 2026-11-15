import { QColor } from "@nodegui/nodegui";

export function map(
    val: number,
    inMin: number,
    inMax: number,
    outMin: number,
    outMax: number,
    clamp: boolean = false
): number {
    const inSpan = inMax - inMin;
    if (inSpan === 0) return outMin;

    const result = outMin + ((val - inMin) / inSpan) * (outMax - outMin);

    if (!clamp) return result;

    const min = Math.min(outMin, outMax);
    const max = Math.max(outMin, outMax);
    return Math.max(min, Math.min(max, result));
}

/** A "nice" grid step (1, 2 or 5 × 10^n) giving roughly `targetTicks` steps over `span`. */
export function niceStep(span: number, targetTicks: number): number {
    if (!(span > 0)) return 1;
    const raw = span / Math.max(1, targetTicks);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    const nice = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
    return nice * mag;
}

/** Formatter showing just enough decimals for values on a grid of `step`. */
export function stepFormat(step: number): (v: number) => string {
    const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
    return (v) => (Math.abs(v) < step * 1e-6 ? 0 : v).toFixed(decimals);
}


/** QColor from "#rrggbb", "#rrggbbaa" (CSS-style alpha last) or any Qt colour name. */
export function makeColor(c: string): QColor {
    const m = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(c);
    if (!m) return new QColor(c);
    const n = parseInt(m[1], 16);
    return new QColor((n >> 16) & 255, (n >> 8) & 255, n & 255, parseInt(m[2], 16));
}
