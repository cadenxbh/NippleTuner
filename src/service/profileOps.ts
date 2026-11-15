/**
 * Profile picking shared by the GUI's command handler and the CLI's
 * offline mode (Qt-free).
 */
import { readJSON, writeJSON } from "../util/storage";

export interface NamedProfile {
	id: string;
	name: string;
}

const STATE_FILE = "state.json";

/**
 * Finds a profile by: 1-based number, exact id, exact name, case-insensitive
 * name, or a unique case-insensitive prefix. Throws a readable error.
 */
export function findProfile<P extends NamedProfile>(profiles: P[], spec: string): P {
	if (!profiles.length) throw new Error("There are no saved profiles yet. Save one in NippleTuner first.");
	const s = spec.trim();
	if (/^\d+$/.test(s)) {
		const p = profiles[Number(s) - 1];
		if (p) return p;
		throw new Error(`There's no profile #${s} (there are ${profiles.length}).`);
	}
	const lower = s.toLowerCase();
	const exact = profiles.find((p) => p.id === s || p.name === s) ?? profiles.find((p) => p.name.toLowerCase() === lower);
	if (exact) return exact;
	const prefixed = profiles.filter((p) => p.name.toLowerCase().startsWith(lower));
	if (prefixed.length === 1) return prefixed[0];
	if (prefixed.length > 1) throw new Error(`"${spec}" matches several profiles: ${prefixed.map((p) => p.name).join(", ")}`);
	throw new Error(`No profile called "${spec}". Profiles: ${profiles.map((p) => p.name).join(", ")}`);
}

/** Next/previous profile after `currentId` (wraps; starts at the first/last). */
export function cycleProfile<P extends NamedProfile>(profiles: P[], currentId: string | null, step: 1 | -1): P {
	if (!profiles.length) throw new Error("There are no saved profiles yet. Save one in NippleTuner first.");
	const i = profiles.findIndex((p) => p.id === currentId);
	if (i < 0) return step > 0 ? profiles[0] : profiles[profiles.length - 1];
	return profiles[(i + step + profiles.length) % profiles.length];
}

/** Last profile that was applied (for `toggle`), remembered across restarts. */
export function lastAppliedId(): string | null {
	return readJSON<{ lastApplied?: string | null }>(STATE_FILE, {}).lastApplied ?? null;
}

export function rememberApplied(id: string | null): void {
	if (!id || id === lastAppliedId()) return;
	writeJSON(STATE_FILE, { ...readJSON<object>(STATE_FILE, {}), lastApplied: id });
}
