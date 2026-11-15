/**
 * Low-level Linux input plumbing: evdev / uinput constants, ioctl bindings
 * (via koffi FFI into libc) and input_event (de)serialisation.
 *
 * Assumes a 64-bit Linux ABI (struct input_event == 24 bytes).
 */
import * as koffi from "koffi";

// ---------------------------------------------------------------------------
// Event types / codes (linux/input-event-codes.h)
// ---------------------------------------------------------------------------
export const EV_SYN = 0x00;
export const EV_KEY = 0x01;
export const EV_REL = 0x02;
export const EV_ABS = 0x03;
export const EV_MSC = 0x04;
export const EV_MAX = 0x1f;

export const SYN_REPORT = 0;
export const SYN_DROPPED = 3;

export const REL_X = 0x00;
export const REL_Y = 0x01;
export const REL_HWHEEL = 0x06;
export const REL_WHEEL = 0x08;
export const REL_MAX = 0x0f;

export const KEY_MAX = 0x2ff;
export const MSC_MAX = 0x07;

export const INPUT_PROP_POINTER = 0x00;
export const INPUT_PROP_POINTING_STICK = 0x05;
export const INPUT_PROP_MAX = 0x1f;

export const BUS_VIRTUAL = 0x06;

// ---------------------------------------------------------------------------
// ioctl request encoding (asm-generic/ioctl.h)
// ---------------------------------------------------------------------------
const IOC_NONE = 0;
const IOC_WRITE = 1;
const IOC_READ = 2;

function IOC(dir: number, type: string, nr: number, size: number): number {
	// >>> 0 keeps it an unsigned 32-bit value
	return ((dir << 30) | (size << 16) | (type.charCodeAt(0) << 8) | nr) >>> 0;
}

export const EVIOCGID = IOC(IOC_READ, "E", 0x02, 8);
export const EVIOCGNAME = (len: number) => IOC(IOC_READ, "E", 0x06, len);
export const EVIOCGPROP = (len: number) => IOC(IOC_READ, "E", 0x09, len);
export const EVIOCGBIT = (ev: number, len: number) => IOC(IOC_READ, "E", 0x20 + ev, len);
export const EVIOCGRAB = IOC(IOC_WRITE, "E", 0x90, 4);
/** Revokes this fd's access: pending reads return immediately (ENODEV). */
export const EVIOCREVOKE = IOC(IOC_WRITE, "E", 0x91, 4);

export const UI_DEV_CREATE = IOC(IOC_NONE, "U", 1, 0);
export const UI_DEV_DESTROY = IOC(IOC_NONE, "U", 2, 0);
const UINPUT_SETUP_SIZE = 8 + 80 + 4; // struct input_id + name[80] + ff_effects_max
export const UI_DEV_SETUP = IOC(IOC_WRITE, "U", 3, UINPUT_SETUP_SIZE);
export const UI_SET_EVBIT = IOC(IOC_WRITE, "U", 100, 4);
export const UI_SET_KEYBIT = IOC(IOC_WRITE, "U", 101, 4);
export const UI_SET_RELBIT = IOC(IOC_WRITE, "U", 102, 4);
export const UI_SET_MSCBIT = IOC(IOC_WRITE, "U", 104, 4);
export const UI_SET_PROPBIT = IOC(IOC_WRITE, "U", 110, 4);

// ---------------------------------------------------------------------------
// libc ioctl via FFI (lazy so merely importing this module never fails)
// ---------------------------------------------------------------------------
let ioctlInt: ((fd: number, req: number, arg: number) => number) | null = null;
let ioctlPtr: ((fd: number, req: number, buf: Buffer | null) => number) | null = null;

function bind(): void {
	if (ioctlInt) return;
	const libc = koffi.load("libc.so.6");
	// ioctl is variadic; on x86_64/aarch64 calling it with a fixed int/pointer
	// third argument is ABI-compatible.
	ioctlInt = libc.func("ioctl", "int", ["int", "unsigned long", "int"]) as any;
	ioctlPtr = libc.func("ioctl", "int", ["int", "unsigned long", "void *"]) as any;
}

function check(ret: number, what: string): number {
	if (ret < 0) {
		const errno = koffi.errno();
		throw new Error(`ioctl ${what} failed (errno ${errno})`);
	}
	return ret;
}

export function ioctlValue(fd: number, req: number, arg: number, what = "?"): number {
	bind();
	return check(ioctlInt!(fd, req, arg), what);
}

/** ioctl with a buffer argument (kernel reads from / writes into `buf`). */
export function ioctlBuffer(fd: number, req: number, buf: Buffer | null, what = "?"): number {
	bind();
	return check(ioctlPtr!(fd, req, buf), what);
}

// ---------------------------------------------------------------------------
// Capability helpers
// ---------------------------------------------------------------------------
export function testBit(buf: Buffer, bit: number): boolean {
	const byte = bit >> 3;
	return byte < buf.length && (buf[byte] & (1 << (bit & 7))) !== 0;
}

export function bitsSet(buf: Buffer, max: number): number[] {
	const out: number[] = [];
	for (let i = 0; i <= max; i++) if (testBit(buf, i)) out.push(i);
	return out;
}

/** Returns the list of codes set for the given event type (or event types if ev = 0). */
export function queryBits(fd: number, ev: number, max: number): number[] {
	const buf = Buffer.alloc((max >> 3) + 1);
	ioctlBuffer(fd, EVIOCGBIT(ev, buf.length), buf, "EVIOCGBIT");
	return bitsSet(buf, max);
}

export function queryProps(fd: number): number[] {
	const buf = Buffer.alloc((INPUT_PROP_MAX >> 3) + 1);
	ioctlBuffer(fd, EVIOCGPROP(buf.length), buf, "EVIOCGPROP");
	return bitsSet(buf, INPUT_PROP_MAX);
}

export function queryName(fd: number): string {
	const buf = Buffer.alloc(256);
	ioctlBuffer(fd, EVIOCGNAME(buf.length), buf, "EVIOCGNAME");
	const end = buf.indexOf(0);
	return buf.toString("utf8", 0, end < 0 ? buf.length : end);
}

export interface InputId {
	bustype: number;
	vendor: number;
	product: number;
	version: number;
}

export function queryId(fd: number): InputId {
	const buf = Buffer.alloc(8);
	ioctlBuffer(fd, EVIOCGID, buf, "EVIOCGID");
	return {
		bustype: buf.readUInt16LE(0),
		vendor: buf.readUInt16LE(2),
		product: buf.readUInt16LE(4),
		version: buf.readUInt16LE(6),
	};
}

// ---------------------------------------------------------------------------
// struct input_event
// ---------------------------------------------------------------------------
export const INPUT_EVENT_SIZE = 24;

export interface InputEvent {
	/** Kernel timestamp in milliseconds (CLOCK_MONOTONIC on most systems). */
	time: number;
	type: number;
	code: number;
	value: number;
}

export function readInputEvent(buf: Buffer, offset: number): InputEvent {
	const sec = Number(buf.readBigInt64LE(offset));
	const usec = Number(buf.readBigInt64LE(offset + 8));
	return {
		time: sec * 1000 + usec / 1000,
		type: buf.readUInt16LE(offset + 16),
		code: buf.readUInt16LE(offset + 18),
		value: buf.readInt32LE(offset + 20),
	};
}

/** Serialises events for writing to uinput (timestamps are filled in by the kernel). */
export function writeInputEvents(events: { type: number; code: number; value: number }[]): Buffer {
	const buf = Buffer.alloc(events.length * INPUT_EVENT_SIZE);
	events.forEach((e, i) => {
		const o = i * INPUT_EVENT_SIZE;
		buf.writeUInt16LE(e.type, o + 16);
		buf.writeUInt16LE(e.code, o + 18);
		buf.writeInt32LE(e.value, o + 20);
	});
	return buf;
}

export function makeUinputSetup(name: string, id: InputId): Buffer {
	const buf = Buffer.alloc(UINPUT_SETUP_SIZE);
	buf.writeUInt16LE(id.bustype, 0);
	buf.writeUInt16LE(id.vendor, 2);
	buf.writeUInt16LE(id.product, 4);
	buf.writeUInt16LE(id.version, 6);
	buf.write(name.slice(0, 79), 8, "utf8");
	return buf;
}
