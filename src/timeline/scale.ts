import { addDays, addMonths, dayDifference, startOfMonth } from '../planning/dates';
import type { DateKey, ProjectDates, TimelineScale } from '../planning/types';

export const TIMELINE_NAME_WIDTH = 210;
export const TIMELINE_ROW_HEIGHT = 48;
export const TIMELINE_AXIS_HEIGHT = 64;

export interface TimelineLayout {
	start: DateKey;
	end: DateKey;
	days: number;
	pixelsPerDay: number;
	width: number;
}

export function clampZoom(value: number): number {
	return Number.isFinite(value) ? Math.min(8, Math.max(0.5, value)) : 1;
}

/** End is exclusive, so leap years and month boundaries retain their real widths. */
export function timelineLayout(date: DateKey, scale: TimelineScale, zoom: number): TimelineLayout {
	const month = Number(date.slice(5, 7));
	let start = startOfMonth(date);
	let months = 1;
	if (scale === 'quarter') { start = addMonths(start, -((month - 1) % 3)); months = 3; }
	if (scale === 'year' || scale === 'five-years') {
		start = `${date.slice(0, 4)}-01-01`;
		months = scale === 'five-years' ? 60 : 12;
	}
	const end = addMonths(start, months);
	const days = dayDifference(start, end);
	const base = { month: 30, quarter: 14, year: 5, 'five-years': 1.2 }[scale];
	const pixelsPerDay = base * clampZoom(zoom);
	return { start, end, days, pixelsPerDay, width: days * pixelsPerDay };
}

export function dateToPixel(date: DateKey, layout: TimelineLayout): number {
	return dayDifference(layout.start, date) * layout.pixelsPerDay;
}

/** Pointer coordinates use floor: the right boundary belongs to the following day. */
export function pixelToDate(pixel: number, layout: TimelineLayout, clamp = true): DateKey {
	const day = Math.floor(pixel / layout.pixelsPerDay + 1e-9);
	return addDays(layout.start, clamp ? Math.min(layout.days - 1, Math.max(0, day)) : day);
}

export interface BarGeometry {
	left: number;
	width: number;
	before: boolean;
	after: boolean;
	single: boolean;
}

/** Clip inclusive project ranges against the exclusive timeline window. */
export function barGeometry(range: { start: DateKey; end: DateKey }, layout: TimelineLayout): BarGeometry | undefined {
	const start = range.start <= range.end ? range.start : range.end;
	const end = range.start <= range.end ? range.end : range.start;
	if (end < layout.start || start >= layout.end) return undefined;
	const left = Math.max(0, dateToPixel(start, layout));
	const right = Math.min(layout.width, dateToPixel(addDays(end, 1), layout));
	return { left, width: right - left, before: start < layout.start,
		after: end >= layout.end, single: start === end };
}

/** Resizing a marker creates the other edge at its original fallback date. */
export function resizeDates(project: ProjectDates, edge: 'start' | 'deadline', date: DateKey): ProjectDates {
	const start = project.start ?? project.deadline ?? date;
	const deadline = project.deadline ?? project.start ?? date;
	return edge === 'start' ? { start: date <= deadline ? date : deadline, deadline }
		: { start, deadline: date >= start ? date : start };
}
