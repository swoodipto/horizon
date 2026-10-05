import { PROJECT_STATUSES, projectStatusForTags } from './project-status';
import type { TaggedEntry, TaggedMetadata } from './tagged-notes';

export type ProjectStatusTag = typeof PROJECT_STATUSES[number]['tag'];
export type ProjectFilter = 'all' | ProjectStatusTag[];

/** Cycle visible filters with All at either end; arrows replace multi-selection. */
export function cycleProjectFilter(filter: ProjectFilter, available: readonly ProjectStatusTag[], direction: -1 | 1): ProjectFilter {
	if (!available.length) return 'all';
	const selected = filter === 'all' ? [] : available.filter(tag => filter.includes(tag));
	const current = direction === 1 ? selected.at(-1) : selected[0];
	const index = current ? available.indexOf(current) + 1 : 0;
	const next = (index + direction + available.length + 1) % (available.length + 1);
	const tag = available[next - 1];
	return next === 0 || !tag ? 'all' : [tag];
}

/** Shift arrows add the next visible status in that direction, stopping at the ends. */
export function extendProjectFilter(filter: ProjectFilter, available: readonly ProjectStatusTag[], direction: -1 | 1): ProjectFilter {
	const selected = filter === 'all' ? [] : available.filter(tag => filter.includes(tag));
	const edge = direction === 1 ? selected.at(-1) : selected[0];
	const next = edge ? available.indexOf(edge) + direction : direction === 1 ? 0 : available.length - 1;
	const tag = available[next];
	return tag ? normalizeProjectFilter([...selected, tag]) : filter;
}

export function normalizeProjectFilter(value: unknown): ProjectFilter {
	const values: unknown[] = Array.isArray(value) ? value : [value];
	const selected = PROJECT_STATUSES.filter(status => values.includes(status.tag)).map(status => status.tag);
	return selected.length ? selected : 'all';
}

export function toggleProjectFilter(filter: ProjectFilter, tag: ProjectStatusTag): ProjectFilter {
	const selected = filter === 'all' ? [] : filter;
	return normalizeProjectFilter(selected.includes(tag)
		? selected.filter(value => value !== tag) : [...selected, tag]);
}

/** A plain click replaces the selection; clicking its sole active pill clears it. */
export function selectProjectFilter(filter: ProjectFilter, tag: ProjectStatusTag, multiple: boolean): ProjectFilter {
	if (multiple) return toggleProjectFilter(filter, tag);
	return filter !== 'all' && filter.length === 1 && filter[0] === tag ? 'all' : [tag];
}

/** Read the complete list, not its filtered result, so other pills stay reachable. */
export function availableProjectStatuses<T extends { path: string; basename: string }>(
	entries: TaggedEntry<T>[], getStatus: (entry: TaggedEntry<T>) => typeof PROJECT_STATUSES[number],
): typeof PROJECT_STATUSES[number][] {
	const present = new Set(entries.map(entry => getStatus(entry).tag));
	return PROJECT_STATUSES.filter(status => present.has(status.tag));
}

export function reconcileProjectFilter(filter: ProjectFilter, available: typeof PROJECT_STATUSES[number][]): ProjectFilter {
	if (available.length < 2) return 'all';
	return filter === 'all' ? filter : normalizeProjectFilter(filter.filter(tag => available.some(status => status.tag === tag)));
}

export function projectFilterLabel(filter: ProjectFilter): string {
	return filter === 'all' ? 'all' : filter.join(', ');
}

/** A line's status belongs to that line, independently of its note's properties. */
export function projectEntryStatus(
	entry: { line?: number }, metadata: Pick<TaggedMetadata, 'noteTags' | 'lineTags'>,
): typeof PROJECT_STATUSES[number] {
	const tags = entry.line === undefined ? metadata.noteTags
		: metadata.lineTags.filter(tag => tag.position.start.line === entry.line).map(tag => tag.tag);
	return projectStatusForTags(tags);
}

/** Filter before building the tree so matching children survive hidden parents. */
export function filterProjectEntries<T extends { path: string; basename: string }>(
	entries: TaggedEntry<T>[], filter: ProjectFilter,
	getStatus: (entry: TaggedEntry<T>) => typeof PROJECT_STATUSES[number],
): TaggedEntry<T>[] {
	return filter === 'all' ? entries : entries.filter(entry => filter.includes(getStatus(entry).tag));
}
