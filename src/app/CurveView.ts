import GraphWidget from "../widgets/GraphWidget";
import NipplePreviewWidget from "../widgets/NipplePreviewWidget";
import { currentTheme } from "../util/theme";
import { Tuning } from "./tuning";

/**
 * Draws a tuning onto the graph (curve samples, 1:1 line, deadzone/limit
 * bands) and the stick preview (zones, rings, scale). Also decides the
 * shared display range, which the live view needs to place its dots.
 */
export default class CurveView {
	/** Speed at the edge of the preview / top of the graph (counts/ms). */
	displayMax = 1;

	constructor(private graph: GraphWidget, private preview: NipplePreviewWidget) {}

	render(t: Tuning, independentAxes: boolean): void {
		const { graph, preview } = this;
		const COLORS = currentTheme().accent; // light/dark-appropriate accents
		const { curve: c, entry, sens, deadzone, limit, limited, maxSpeed: max } = t;

		const samples = c.points
			.map((y, i) => [i * c.step, y] as [number, number])
			.filter(([x]) => x <= max + c.step); // one sample past full scale at most
		const peakOut = Math.max(...samples.filter(([x]) => x <= max).map(([, y]) => y), c.evaluate(max));
		// Output can exceed the input range (sensitivity > 1); fit both.
		this.displayMax = Math.max(max, peakOut * Math.max(sens.x, sens.y));

		// --- graph
		const sensText = independentAxes ? `X ${sens.x.toFixed(2)}× · Y ${sens.y.toFixed(2)}×` : `${sens.x.toFixed(2)}×`;
		graph.configure({
			subtitle: `${entry.name} · ${sensText} · step ${c.step.toFixed(2)} · ${c.points.length} points`,
			x: { min: 0, max },
			y: { min: 0, max: this.displayMax },
		});
		graph.setSeries("identity", {
			points: [[0, 0], [max, max]],
			label: "1:1",
			color: COLORS.identity,
			width: 1,
			lineStyle: "dash",
			z: 0,
		});
		const curveSeries = (k: number, label: string, color: string, z: number) => ({
			points: samples.map(([x, y]) => [x, y * k] as [number, number]),
			label,
			color,
			width: 2,
			style: "both" as const,
			pointRadius: 2,
			z,
		});
		if (independentAxes) {
			graph.removeSeries("curve");
			graph.setSeries("curve-x", curveSeries(sens.x, `${entry.name} X`, COLORS.curveX, 1));
			graph.setSeries("curve-y", curveSeries(sens.y, `${entry.name} Y`, COLORS.curveY, 2));
		} else {
			graph.removeSeries("curve-x");
			graph.removeSeries("curve-y");
			graph.setSeries("curve", curveSeries(sens.x, entry.name, COLORS.curve, 1));
		}

		// --- deadzone + limit (input speeds) on both views
		const showDz = deadzone > 0;
		graph.setRegion("deadzone", showDz ? { axis: "x", from: 0, to: deadzone, color: COLORS.deadzoneFill, label: "deadzone" } : null);
		graph.setMarker("deadzone", showDz ? { axis: "x", value: deadzone, color: COLORS.deadzone, label: deadzone.toFixed(2) } : null);
		graph.setRegion("limit", limited ? { axis: "x", from: limit, to: max, color: COLORS.limitFill, label: "limited" } : null);
		graph.setMarker("limit", limited ? { axis: "x", value: limit, color: COLORS.limit, label: limit.toFixed(2) } : null);

		preview.configure({ maxValue: this.displayMax, subtitle: "Speed (counts/ms) · pink = input, gold = tuned output" });
		preview.setZone("deadzone", showDz ? { from: 0, to: deadzone, color: COLORS.deadzoneFill } : null);
		preview.setRing("deadzone", showDz ? { value: deadzone, color: COLORS.deadzone, label: `deadzone ${deadzone.toFixed(2)}` } : null);
		preview.setZone("limit", limited ? { from: limit, to: max, color: COLORS.limitFill } : null);
		preview.setRing("limit", limited ? { value: limit, color: COLORS.limit, label: `limit ${limit.toFixed(2)}` } : null);
		// When output can go past the stick's input range, mark where input ends.
		preview.setRing("full-scale", this.displayMax > max + 1e-9
			? { value: max, color: COLORS.fullScale, width: 1, lineStyle: "dash", label: `input max ${max.toFixed(1)}` }
			: null);
	}
}
