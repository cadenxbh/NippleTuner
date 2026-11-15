import { newId, readJSON, uniqueName, writeJSON } from "../util/storage";

/** Everything the main window's controls can be set to. */
export interface ProfileSettings {
	curveId: string;
	deadzone: number;
	/** null = no limit (full scale). */
	limit: number | null;
	step: number;
	independentAxes: boolean;
	sensitivity: number;
	sensitivityX: number;
	sensitivityY: number;
}

export interface Profile extends ProfileSettings {
	id: string;
	name: string;
}

interface StoredProfiles {
	activeId: string | null;
	profiles: Profile[];
}

const FILE = "profiles.json";

export default class ProfileStore {
	private data: StoredProfiles;
	private listeners: (() => void)[] = [];

	constructor() {
		const d = readJSON<StoredProfiles>(FILE, { activeId: null, profiles: [] });
		this.data = { activeId: d.activeId ?? null, profiles: Array.isArray(d.profiles) ? d.profiles : [] };
	}

	onChange(listener: () => void): void {
		this.listeners.push(listener);
	}

	get all(): Profile[] {
		return [...this.data.profiles];
	}

	get active(): Profile | null {
		return this.data.profiles.find((p) => p.id === this.data.activeId) ?? null;
	}

	get(id: string): Profile | undefined {
		return this.data.profiles.find((p) => p.id === id);
	}

	setActive(id: string | null): void {
		this.data.activeId = id;
		this.save();
	}

	create(name: string, settings: ProfileSettings): Profile {
		const p: Profile = { ...settings, id: newId("profile"), name: uniqueName(name, this.names()) };
		this.data.profiles.push(p);
		this.data.activeId = p.id;
		this.save();
		return p;
	}

	overwrite(id: string, settings: ProfileSettings): Profile {
		const p = this.mustGet(id);
		Object.assign(p, settings);
		this.save();
		return p;
	}

	rename(id: string, name: string): Profile {
		const p = this.mustGet(id);
		p.name = uniqueName(name, this.names().filter((n) => n !== p.name));
		this.save();
		return p;
	}

	remove(id: string): void {
		this.data.profiles = this.data.profiles.filter((p) => p.id !== id);
		if (this.data.activeId === id) this.data.activeId = null;
		this.save();
	}

	names(): string[] {
		return this.data.profiles.map((p) => p.name);
	}

	private mustGet(id: string): Profile {
		const p = this.get(id);
		if (!p) throw new Error(`Unknown profile ${id}`);
		return p;
	}

	private save(): void {
		writeJSON(FILE, this.data);
		for (const l of this.listeners) l();
	}
}
