import { addDays, addMonths, dayDifference, daysInMonth, projectRange, startOfMonth, startOfWeek } from '../planning/dates';
import type { CalendarMode, DateKey, PlanningProject } from '../planning/types';

export interface CalendarSegment {
	project: PlanningProject;
	start: DateKey;
	end: DateKey;
	column: number;
	length: number;
	lane: number;
	continuesBefore: boolean;
	continuesAfter: boolean;
}

export interface CalendarWeek {
	start: DateKey;
	days: DateKey[];
	segments: CalendarSegment[];
	lanes: number;
}

/** A date range is inclusive: two projects sharing a date need separate lanes. */
export function calendarWeek(start: DateKey, count: number, projects: readonly PlanningProject[]): CalendarWeek {
	const end = addDays(start, count - 1);
	const segments: CalendarSegment[] = [];
	for (const project of projects) {
		const range = projectRange(project);
		if (!range || range.end < range.start || range.end < start || range.start > end) continue;
		const clippedStart = range.start < start ? start : range.start;
		const clippedEnd = range.end > end ? end : range.end;
		segments.push({
			project, start: clippedStart, end: clippedEnd,
			column: dayDifference(start, clippedStart),
			length: dayDifference(clippedStart, clippedEnd) + 1,
			lane: 0, continuesBefore: range.start < start, continuesAfter: range.end > end,
		});
	}
	segments.sort((a, b) => a.column - b.column || b.length - a.length || a.project.title.localeCompare(b.project.title));
	const laneEnds: number[] = [];
	for (const segment of segments) {
		let lane = laneEnds.findIndex(last => last < segment.column);
		if (lane === -1) lane = laneEnds.length;
		segment.lane = lane;
		laneEnds[lane] = segment.column + segment.length - 1;
	}
	return { start, days: Array.from({ length: count }, (_, index) => addDays(start, index)), segments, lanes: laneEnds.length };
}

export function calendarWeeks(date: DateKey, mode: Exclude<CalendarMode, 'year'>, projects: readonly PlanningProject[]): CalendarWeek[] {
	if (mode === 'day') return [calendarWeek(date, 1, projects)];
	if (mode === 'four-days') return [calendarWeek(date, 4, projects)];
	if (mode === 'week') return [calendarWeek(startOfWeek(date), 7, projects)];
	const month = startOfMonth(date);
	const start = startOfWeek(month);
	const last = addDays(month, daysInMonth(month) - 1);
	const count = Math.ceil((dayDifference(start, last) + 1) / 7);
	return Array.from({ length: count }, (_, index) => calendarWeek(addDays(start, index * 7), 7, projects));
}

export function yearMonths(date: DateKey): DateKey[] {
	const year = `${date.slice(0, 4)}-01-01`;
	return Array.from({ length: 12 }, (_, index) => addMonths(year, index));
}
