export interface SidebarEntryIdentity { path: string; line?: number }

/** Prefer exact entry identity; a sole inline entry can represent its open source note. */
export function currentSidebarEntries<T extends SidebarEntryIdentity>(entries: readonly T[],
	active?: SidebarEntryIdentity): T[] {
	if (!active) return [];
	const matching = entries.filter(entry => entry.path === active.path);
	const exact = matching.filter(entry => entry.line === active.line);
	return exact.length ? exact : active.line === undefined && matching.length === 1 ? matching : [];
}
