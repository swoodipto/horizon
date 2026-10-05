import { parseDate } from '../planning/dates';

export interface DateEntryGroup<T> {
	label?: string;
	nest?: boolean;
	entries: T[];
}

/** Someday takes precedence over dates; upcoming stays flat to preserve date order. */
export function groupEntriesByDate<T>(entries: readonly T[], getMetadata: (entry: T) => {
	status: string; start?: unknown; deadline?: unknown;
}): DateEntryGroup<T>[] {
	const undated: T[] = [];
	const upcoming: { entry: T; date: string }[] = [];
	const someday: T[] = [];
	for (const entry of entries) {
		const metadata = getMetadata(entry);
		const date = parseDate(metadata.start) ?? parseDate(metadata.deadline);
		if (metadata.status === 'someday') someday.push(entry);
		else if (date) upcoming.push({ entry, date });
		else undated.push(entry);
	}
	upcoming.sort((a, b) => a.date.localeCompare(b.date));
	const groups: DateEntryGroup<T>[] = [];
	if (undated.length) groups.push({ entries: undated, nest: true });
	if (upcoming.length) groups.push({ label: 'Upcoming', entries: upcoming.map(item => item.entry), nest: false });
	if (someday.length) groups.push({ label: 'Someday', entries: someday, nest: true });
	return groups;
}
