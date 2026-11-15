import { findTrackPoint, listPointerDevices, PointerDeviceInfo } from "../pointer";

/*
 * Which pointer device to use. Saved as name + physical path rather than
 * /dev/input/eventN, because event numbers can change between boots.
 * Shared by the GUI, the permission check and the background service.
 */

export function deviceKey(d: PointerDeviceInfo): string {
	return `${d.name}|${d.phys}`;
}

export function deviceLabel(d: PointerDeviceInfo): string {
	return `${d.name}${d.isTrackPoint ? " (TrackPoint)" : ""} — ${d.devnode.replace("/dev/input/", "")}`;
}

export interface ResolvedDevice {
	info: PointerDeviceInfo | null;
	/** A specific device was chosen but isn't connected (fell back to automatic). */
	missing: boolean;
}

/** null key = automatic (first TrackPoint / pointing stick). */
export function resolveDevice(key: string | null): ResolvedDevice {
	if (key) {
		const devices = listPointerDevices();
		const [name, phys] = key.split("|");
		const exact = devices.find((d) => d.name === name && d.phys === phys);
		// Same device on a different port (e.g. a USB mouse moved) still counts.
		const byName = devices.find((d) => d.name === name);
		const found = exact ?? byName;
		if (found) return { info: found, missing: false };
		return { info: findTrackPoint(), missing: true };
	}
	return { info: findTrackPoint(), missing: false };
}
