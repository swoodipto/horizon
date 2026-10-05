import type { DateKey, PlanningProject, ProjectDates } from './types';

const DAY_MS = 86_400_000;

export const DATE_PROPERTIES = { start: 'start date', deadline: 'deadline' } as const;

function key(year: number, month: number, day: number): DateKey {
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** YAML's date-only Date values are parsed at UTC midnight. */
export function parseDate(value: unknown): DateKey | undefined {
	if (value instanceof Date) {
		if (!Number.isFinite(value.getTime())) return undefined;
		return parseDate(key(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()));
	}
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
	const year = Number(value.slice(0, 4));
	const month = Number(value.slice(5, 7));
	const day = Number(value.slice(8, 10));
	if (year < 1 || month < 1 || month > 12 || day < 1) return undefined;
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const maximum = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
	return day <= maximum ? value : undefined;
}

export function today(): DateKey {
	const date = new Date();
	return key(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** UTC is used only as a civil-day counter, never to interpret stored dates. */
function civil(date: DateKey): Date {
	if (!parseDate(date)) throw new Error('Use a valid date in YYYY-MM-DD format.');
	const result = new Date(0);
	result.setUTCFullYear(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
	return result;
}

function civilKey(date: Date): DateKey {
	const result = key(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
	if (!parseDate(result)) throw new Error('The date is outside the supported calendar range.');
	return result;
}

export function addDays(date: DateKey, amount: number): DateKey {
	if (!Number.isInteger(amount)) throw new Error('Use a whole number of days.');
	const result = civil(date);
	result.setUTCDate(result.getUTCDate() + amount);
	return civilKey(result);
}

export function dayDifference(from: DateKey, to: DateKey): number {
	return (civil(to).getTime() - civil(from).getTime()) / DAY_MS;
}

export function startOfWeek(date: DateKey): DateKey {
	return addDays(date, -((civil(date).getUTCDay() + 6) % 7));
}

export function startOfMonth(date: DateKey): DateKey {
	return civilKey(new Date(civil(date).setUTCDate(1)));
}

export function daysInMonth(date: DateKey): number {
	const result = civil(date);
	result.setUTCMonth(result.getUTCMonth() + 1, 0);
	return result.getUTCDate();
}

export function addMonths(date: DateKey, amount: number): DateKey {
	if (!Number.isInteger(amount)) throw new Error('Use a whole number of months.');
	const result = civil(date);
	const day = result.getUTCDate();
	result.setUTCDate(1);
	result.setUTCMonth(result.getUTCMonth() + amount);
	result.setUTCDate(Math.min(day, daysInMonth(civilKey(result))));
	return civilKey(result);
}

export function projectRange(project: ProjectDates): { start: DateKey; end: DateKey } | undefined {
	const start = parseDate(project.start) ?? parseDate(project.deadline);
	const end = parseDate(project.deadline) ?? parseDate(project.start);
	return start && end ? { start, end } : undefined;
}

/** Moving a one-date project does not silently add its missing property. */
export function shiftProjectDates(project: PlanningProject, days: number): ProjectDates {
	return {
		...(project.start ? { start: addDays(project.start, days) } : {}),
		...(project.deadline ? { deadline: addDays(project.deadline, days) } : {}),
	};
}
