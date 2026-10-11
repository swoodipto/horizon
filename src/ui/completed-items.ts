import type { TaggedEntry } from './tagged-notes';
import { parseDate } from '../planning/dates';

/** Date order is independent of relationship nesting; undated entries come last. */
export function newestCompletedFirst<T extends { path: string }>(entries: readonly TaggedEntry<T>[], dateFor: (entry: TaggedEntry<T>) => unknown): TaggedEntry<T>[] {
	const dates = new Map(entries.map(entry => [entry, parseDate(dateFor(entry)) ?? '']));
	return [...entries].sort((a, b) => (dates.get(b) ?? '').localeCompare(dates.get(a) ?? '') ||
		a.text.localeCompare(b.text, undefined, { numeric: true, sensitivity: 'base' }) ||
		a.file.path.localeCompare(b.file.path) || (a.line ?? -1) - (b.line ?? -1));
}
