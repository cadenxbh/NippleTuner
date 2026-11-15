import { CURVE_PRESETS, CurvePreset } from "../pointer";
import { newId, readJSON, uniqueName, writeJSON } from "../util/storage";
import { CurvePoint, monotoneSpline } from "./spline";

/**
 * All curve shapes: the built-in presets (read-only) plus user curves made
 * of control points. Every entry is a CurvePreset, so it plugs straight into
 * makePresetCurve().
 */
export interface CurveEntry extends CurvePreset {
	builtin: boolean;
	/** Control points on the unit square (custom curves only). */
	points?: CurvePoint[];
}

interface StoredCurve {
	id: string;
	name: string;
	points: CurvePoint[];
}

const FILE = "curves.json";

/** Samples a shape into control points, e.g. to start editing from a preset. */
export function sampleShape(shape: (x: number) => number, count = 9): CurvePoint[] {
	const pts: CurvePoint[] = [];
	for (let i = 0; i < count; i++) {
		const x = i / (count - 1);
		pts.push([x, Math.min(1, Math.max(0, shape(x)))]);
	}
	return pts;
}

/** Sorts, clamps to the unit square and pins the ends to (0,0) and (1,1). */
export function normalizePoints(points: CurvePoint[]): CurvePoint[] {
	const inner = points
		.filter(([x]) => x > 0 && x < 1)
		.map(([x, y]) => [x, Math.min(1, Math.max(0, y))] as CurvePoint)
		.sort((a, b) => a[0] - b[0]);
	return [[0, 0], ...inner, [1, 1]];
}

function toEntry(c: StoredCurve): CurveEntry {
	const points = normalizePoints(c.points);
	const spline = monotoneSpline(points);
	return {
		id: c.id,
		name: c.name,
		builtin: false,
		points,
		shape: (x) => Math.max(0, spline(x)),
	};
}

export default class CurveLibrary {
	private custom: CurveEntry[] = [];
	private listeners: (() => void)[] = [];

	constructor() {
		const stored = readJSON<StoredCurve[]>(FILE, []);
		this.custom = stored.filter((c) => c && c.id && Array.isArray(c.points)).map(toEntry);
	}

	onChange(listener: () => void): void {
		this.listeners.push(listener);
	}

	get builtins(): CurveEntry[] {
		return CURVE_PRESETS.map((p) => ({ ...p, builtin: true }));
	}

	get customs(): CurveEntry[] {
		return [...this.custom];
	}

	get all(): CurveEntry[] {
		return [...this.builtins, ...this.custom];
	}

	get(id: string): CurveEntry | undefined {
		return this.all.find((c) => c.id === id);
	}

	names(): string[] {
		return this.all.map((c) => c.name);
	}

	/** Adds a custom curve (name made unique). Returns it. */
	add(name: string, points: CurvePoint[]): CurveEntry {
		const entry = toEntry({ id: newId("curve"), name: uniqueName(name, this.names()), points });
		this.custom.push(entry);
		this.save();
		return entry;
	}

	/** Replaces a custom curve's points (and optionally name). */
	update(id: string, points: CurvePoint[], name?: string): CurveEntry {
		const i = this.indexOfCustom(id);
		const cur = this.custom[i];
		const others = this.names().filter((n) => n !== cur.name);
		const entry = toEntry({ id, name: name !== undefined ? uniqueName(name, others) : cur.name, points });
		this.custom[i] = entry;
		this.save();
		return entry;
	}

	rename(id: string, name: string): CurveEntry {
		const cur = this.custom[this.indexOfCustom(id)];
		return this.update(id, cur.points!, name);
	}

	duplicate(id: string): CurveEntry {
		const src = this.get(id);
		if (!src) throw new Error(`Unknown curve ${id}`);
		return this.add(`${src.name} copy`, src.points ?? sampleShape(src.shape, 17));
	}

	remove(id: string): void {
		this.custom.splice(this.indexOfCustom(id), 1);
		this.save();
	}

	/** Control points for any curve (built-ins are sampled). */
	pointsOf(id: string, samples = 17): CurvePoint[] {
		const c = this.get(id);
		if (!c) return sampleShape((x) => x, 2);
		return c.points ? c.points.map((p) => [...p] as CurvePoint) : sampleShape(c.shape, samples);
	}

	private indexOfCustom(id: string): number {
		const i = this.custom.findIndex((c) => c.id === id);
		if (i < 0) throw new Error(this.builtins.some((b) => b.id === id) ? "Built-in curves can't be changed" : `Unknown curve ${id}`);
		return i;
	}

	private save(): void {
		writeJSON(FILE, this.custom.map((c) => ({ id: c.id, name: c.name, points: c.points })));
		for (const l of this.listeners) l();
	}
}
