import { QIcon, QSize } from "@nodegui/nodegui";
import * as path from "path";

/** Sizes rendered in assets/icons (nippletuner-<size>.png). */
export const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

/** assets/icons/nippletuner-<size>.png (dist/main.cjs → ../assets). */
export function iconFile(size: number): string {
	return path.resolve(__dirname, "..", "assets", "icons", `nippletuner-${size}.png`);
}

let icon: QIcon | null = null;

/**
 * The app icon at every size, so Qt picks a crisp one for the tray, the
 * window's title bar and the taskbar. Kept alive for the process lifetime.
 */
export function appIcon(): QIcon {
	if (!icon) {
		icon = new QIcon();
		for (const size of ICON_SIZES) icon.addFile(iconFile(size), new QSize(size, size));
	}
	return icon;
}
