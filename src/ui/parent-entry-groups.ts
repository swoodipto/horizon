import type { ParentNote } from './parent-notes';

export interface ParentEntryGroup<T> {
	parent?: ParentNote;
	entries: T[];
}

/** Use the first parent as the primary group so each entry appears once. */
export function groupEntriesByParent<T>(entries: T[], getParents: (entry: T) => ParentNote[]): ParentEntryGroup<T>[] {
	const unparented: ParentEntryGroup<T> = { entries: [] };
	const groups = new Map<string, ParentEntryGroup<T>>();
	for (const entry of entries) {
		const parent = getParents(entry)[0];
		if (!parent) { unparented.entries.push(entry); continue; }
		const key = parent.path ?? parent.name;
		let group = groups.get(key);
		if (!group) {
			group = { parent, entries: [] };
			groups.set(key, group);
		}
		group.entries.push(entry);
	}
	return [...(unparented.entries.length ? [unparented] : []), ...groups.values()];
}
