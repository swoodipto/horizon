import { addDays, dayDifference } from '../planning/dates';
import type { DateKey } from '../planning/types';
import type { Completion } from './history';

/** Only observed transitions produce bars; an unobserved week is never a zero. */
export function completionBuckets(events: readonly Completion[]): Array<{ date: DateKey; count: number }> {
	const buckets = new Map<DateKey, Set<number>>();
	for (const event of events) {
		const members = buckets.get(event.bucket) ?? new Set<number>();
		members.add(event.contributorId); buckets.set(event.bucket, members);
	}
	return [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([date, members]) => ({ date, count: members.size }));
}

export function completionBarGeometry(events: readonly Completion[], to: DateKey,
	x: (date: DateKey) => number, baseline: number, height: number): Array<{ date: DateKey; count: number; x: number; width: number; y: number; height: number }> {
	const buckets = completionBuckets(events);
	const maximum = buckets.reduce((maximum, bucket) => Math.max(maximum, bucket.count), 1);
	return buckets.map(bucket => {
		const end = addDays(bucket.date, Math.min(7, Math.max(0, dayDifference(bucket.date, to))));
		const width = Math.max(1, x(end) - x(bucket.date));
		const barHeight = Math.max(2, height * .2 * bucket.count / maximum);
		return { ...bucket, x: x(bucket.date) + width * .1, width: Math.max(1, width * .8), y: baseline - barHeight, height: barHeight };
	});
}
