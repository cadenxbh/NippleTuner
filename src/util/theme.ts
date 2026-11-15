import { ColorGroup, ColorRole, QApplication, QColor } from "@nodegui/nodegui";

/**
 * Colours for the custom-painted widgets, taken from the application palette
 * so they match the native Qt look (light or dark, whatever the system or
 * the Theme preference picked), plus accent colours tuned for each.
 */
export interface ThemeColors {
	dark: boolean;
	window: string;
	base: string;
	text: string;
	mutedText: string;
	border: string;
	gridMajor: string;
	gridMinor: string;
	zeroLine: string;
	highlight: string;
	accent: {
		curve: string;
		curveX: string;
		curveY: string;
		identity: string;
		deadzone: string;
		deadzoneFill: string;
		limit: string;
		limitFill: string;
		fullScale: string;
		tuned: string;
		input: string;
		liveInput: string;
		pointHover: string;
	};
}

function hex(c: QColor): string {
	return "#" + [c.red(), c.green(), c.blue()].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function rgb(h: string): [number, number, number] {
	const n = parseInt(h.slice(1, 7), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blend a → b by t (0..1). */
export function mix(a: string, b: string, t: number): string {
	const [r1, g1, b1] = rgb(a);
	const [r2, g2, b2] = rgb(b);
	const m = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
	return `#${m(r1, r2)}${m(g1, g2)}${m(b1, b2)}`;
}

function luminance(h: string): number {
	const [r, g, b] = rgb(h);
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

const DARK_ACCENTS: ThemeColors["accent"] = {
	curve: "#f38ba8",
	curveX: "#f38ba8",
	curveY: "#94e2d5",
	identity: "#7f849c",
	deadzone: "#f9e2af",
	deadzoneFill: "#f9e2af26",
	limit: "#fab387",
	limitFill: "#fab38726",
	fullScale: "#7f849c",
	tuned: "#c8a95e",
	input: "#ff4081",
	liveInput: "#89b4fa",
	pointHover: "#f9e2af",
};

const LIGHT_ACCENTS: ThemeColors["accent"] = {
	curve: "#d20f39",
	curveX: "#d20f39",
	curveY: "#11807f",
	identity: "#8c8fa1",
	deadzone: "#c47f0a",
	deadzoneFill: "#df8e1d2e",
	limit: "#e05a00",
	limitFill: "#fe640b26",
	fullScale: "#8c8fa1",
	tuned: "#a8801a",
	input: "#e6005c",
	liveInput: "#1e66f5",
	pointHover: "#c47f0a",
};

let cacheKey = "";
let cache: ThemeColors | null = null;

/** Current colours (cheap; re-derived only when the palette changes). */
export function currentTheme(): ThemeColors {
	const p = QApplication.instance().palette();
	const window = hex(p.color(ColorGroup.Active, ColorRole.Window));
	const base = hex(p.color(ColorGroup.Active, ColorRole.Base));
	const text = hex(p.color(ColorGroup.Active, ColorRole.WindowText));
	const highlight = hex(p.color(ColorGroup.Active, ColorRole.Highlight));
	const key = window + base + text + highlight;
	if (cache && key === cacheKey) return cache;

	const dark = luminance(window) < 0.5;
	// Plot areas sit slightly darker (dark mode) / lighter (light mode) than the window.
	const plot = dark ? mix(base, "#000000", 0.18) : mix(base, "#ffffff", 0.6);
	cache = {
		dark,
		window,
		base: plot,
		text,
		mutedText: mix(window, text, 0.7),
		border: mix(window, text, 0.3),
		gridMajor: mix(plot, text, 0.14),
		gridMinor: mix(plot, text, 0.06),
		zeroLine: mix(plot, text, 0.35),
		highlight,
		accent: dark ? DARK_ACCENTS : LIGHT_ACCENTS,
	};
	cacheKey = key;
	return cache;
}

/** Fingerprint of the palette, to notice system theme switches. */
export function paletteKey(): string {
	const t = currentTheme();
	return t.window + t.text + t.highlight;
}
