import { QFont, QFontMetrics, QPainter, QPen } from "@nodegui/nodegui";
import { makeColor } from "./graphics";
import { currentTheme } from "./theme";

/**
 * Greys out a whole custom-painted widget and writes `message` in the middle
 * (used for "paused" graphs when the window isn't focused).
 */
export function paintDimOverlay(painter: QPainter, width: number, height: number, message: string): void {
	const t = currentTheme();
	painter.fillRect(0, 0, width, height, makeColor(t.window + "b8"));

	const font = new QFont("Sans", 10);
	font.setBold(true);
	const fm = new QFontMetrics(font);
	painter.setFont(font);
	const pen = new QPen();
	pen.setColor(makeColor(t.mutedText));
	painter.setPen(pen);
	const lines = message.split("\n");
	const lh = fm.height();
	let y = height / 2 - (lines.length * lh) / 2 + fm.ascent();
	for (const line of lines) {
		painter.drawText((width - fm.horizontalAdvance(line)) / 2, y, line);
		y += lh;
	}
}
