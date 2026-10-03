import { PROJECT_STATUSES, projectStatusForTags } from './project-status';
import type { TaggedEntry, TaggedMetadata } from './tagged-notes';

export type ProjectFilter = 'all' | typeof PROJECT_STATUSES[number]['tag'];

export function normalizeProjectFilter(value: unknown): ProjectFilter {
	return PROJECT_STATUSES.find(status => status.tag === value)?.tag ?? 'all';
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
	return filter === 'all' ? entries : entries.filter(entry => getStatus(entry).tag === filter);
}
