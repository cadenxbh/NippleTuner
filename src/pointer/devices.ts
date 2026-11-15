/**
 * Discovery of relative pointer devices from /proc/bus/input/devices
 * (readable without any special permissions).
 */
import * as fs from "fs";
import * as path from "path";
import { INPUT_PROP_POINTING_STICK, REL_X, REL_Y } from "./linux-input";

export interface PointerDeviceInfo {
	name: string;
	/** e.g. "/dev/input/event6" */
	devnode: string;
	/** sysfs path of the input device, e.g. "/sys/devices/platform/i8042/serio1/input/input5" */
	sysfs: string;
	phys: string;
	bustype: number;
	vendor: number;
	product: number;
	/** INPUT_PROP_POINTING_STICK set (or the name says so) */
	isTrackPoint: boolean;
}

/** Name prefix of virtual devices created by this module (excluded from listings). */
export const VIRTUAL_NAME_SUFFIX = " (NippleTuner)";

function hexBitmapHasBit(hexWords: string | undefined, bit: number): boolean {
	if (!hexWords) return false;
	// Space-separated hex longs, most significant word first.
	const words = hexWords.trim().split(/\s+/).reverse();
	const bitsPerWord = 64;
	const w = words[Math.floor(bit / bitsPerWord)];
	if (!w) return false;
	return ((BigInt("0x" + w) >> BigInt(bit % bitsPerWord)) & 1n) === 1n;
}

export function listPointerDevices(): PointerDeviceInfo[] {
	const text = fs.readFileSync("/proc/bus/input/devices", "utf8");
	const out: PointerDeviceInfo[] = [];

	for (const block of text.split(/\n\s*\n/)) {
		const fields: Record<string, string> = {};
		const bits: Record<string, string> = {};
		let id = "";
		for (const line of block.split("\n")) {
			const m = /^([A-Z]): (.*)$/.exec(line);
			if (!m) continue;
			const [, k, v] = m;
			if (k === "B") {
				const [bk, bv] = v.split("=");
				bits[bk] = bv;
			} else if (k === "I") id = v;
			else fields[k] = v;
		}

		const handlers = fields.H ?? "";
		const ev = /\bevent(\d+)\b/.exec(handlers);
		if (!ev) continue;
		if (!hexBitmapHasBit(bits.REL, REL_X) || !hexBitmapHasBit(bits.REL, REL_Y)) continue;

		const name = /Name="(.*)"/.exec(fields.N ?? "")?.[1] ?? "";
		if (name.endsWith(VIRTUAL_NAME_SUFFIX)) continue;

		const idv = (key: string) => parseInt(new RegExp(`${key}=([0-9a-f]+)`, "i").exec(id)?.[1] ?? "0", 16);

		out.push({
			name,
			devnode: `/dev/input/event${ev[1]}`,
			sysfs: path.join("/sys", (fields.S ?? "").replace(/^Sysfs=/, "")),
			phys: (fields.P ?? "").replace(/^Phys=/, ""),
			bustype: idv("Bus"),
			vendor: idv("Vendor"),
			product: idv("Product"),
			isTrackPoint: hexBitmapHasBit(bits.PROP, INPUT_PROP_POINTING_STICK) || /trackpoint|pointing ?stick/i.test(name),
		});
	}
	return out;
}

/** First pointing stick found, else null. */
export function findTrackPoint(): PointerDeviceInfo | null {
	return listPointerDevices().find((d) => d.isTrackPoint) ?? null;
}
