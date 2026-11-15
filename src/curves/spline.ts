/**
 * Monotone cubic (Fritsch–Carlson) interpolation through control points.
 * Unlike a plain cubic spline it never overshoots between points, so a
 * rising set of points always gives a rising curve.
 */
export type CurvePoint = [number, number];

export function monotoneSpline(points: CurvePoint[]): (x: number) => number {
	const pts = [...points].sort((a, b) => a[0] - b[0]);
	const n = pts.length;
	if (n === 0) return () => 0;
	if (n === 1) return () => pts[0][1];

	const xs = pts.map((p) => p[0]);
	const ys = pts.map((p) => p[1]);
	const h: number[] = [];
	const d: number[] = []; // secant slopes
	for (let i = 0; i < n - 1; i++) {
		h.push(xs[i + 1] - xs[i]);
		d.push(h[i] > 0 ? (ys[i + 1] - ys[i]) / h[i] : 0);
	}

	// Tangents
	const m: number[] = new Array(n);
	m[0] = d[0];
	m[n - 1] = d[n - 2];
	for (let i = 1; i < n - 1; i++) {
		m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
	}
	// Fritsch–Carlson limiter keeps each segment monotone
	for (let i = 0; i < n - 1; i++) {
		if (d[i] === 0) {
			m[i] = 0;
			m[i + 1] = 0;
			continue;
		}
		const a = m[i] / d[i];
		const b = m[i + 1] / d[i];
		const s = a * a + b * b;
		if (s > 9) {
			const t = 3 / Math.sqrt(s);
			m[i] = t * a * d[i];
			m[i + 1] = t * b * d[i];
		}
	}

	return (x: number) => {
		if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
		if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
		let i = 0;
		while (i < n - 2 && x > xs[i + 1]) i++;
		const t = (x - xs[i]) / h[i];
		const t2 = t * t;
		const t3 = t2 * t;
		return (
			(2 * t3 - 3 * t2 + 1) * ys[i] +
			(t3 - 2 * t2 + t) * h[i] * m[i] +
			(-2 * t3 + 3 * t2) * ys[i + 1] +
			(t3 - t2) * h[i] * m[i + 1]
		);
	};
}
