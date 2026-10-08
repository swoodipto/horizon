import { addDays, dayDifference, parseDate, today } from '../planning/dates';
import type { DateKey } from '../planning/types';

export interface PaceInput { progress: number; start?: unknown; deadline?: unknown }
export interface Pace {
	progress: number;
	today: DateKey;
	start?: DateKey;
	deadline?: DateKey;
	kind: 'scheduled' | 'same-day' | 'open-ended' | 'unavailable';
	estimatedEnd?: DateKey;
	estimatedDays?: number;
	message: string;
	requiredToday?: number;
	requiredAverage?: number;
	actualAverage?: number;
	remainingRequired?: number;
	delta?: number;
	overdue: boolean;
}

/** Current percentage and civil-date anchors only. Never reads observed item history. */
export function percentagePace(input: PaceInput, date: DateKey = today()): Pace {
	const start = parseDate(input.start), deadline = parseDate(input.deadline);
	const progress = input.progress;
	const base: Pace = { progress, today: date, start, deadline, kind: 'unavailable', message: '', overdue: false };
	if (!Number.isFinite(progress) || progress < 0 || progress > 100) return { ...base, progress: 0, message: 'Fix progress' };
	const missing = (value: unknown) => value === undefined || value === null || value === '';
	if ((!start && !missing(input.start)) || (!deadline && !missing(input.deadline)) || (start && deadline && deadline < start)) {
		return { ...base, message: 'Fix dates' };
	}
	if (!start) return { ...base, message: 'Add a start date' };
	const elapsed = dayDifference(start, date);
	const actualAverage = elapsed > 0 ? progress / elapsed : undefined;
	if (!deadline) {
		return withEstimate({ ...base, kind: 'open-ended', actualAverage,
			message: progress === 100 ? 'Completed' : elapsed <= 0 ? 'Estimate needs elapsed time' : 'Estimate needs progress' });
	}
	const total = dayDifference(start, deadline);
	const remaining = dayDifference(date, deadline);
	const requiredToday = total === 0 ? (date < start ? 0 : 100) : 100 * Math.max(0, Math.min(1, elapsed / total));
	const overdue = date > deadline && progress < 100;
	const delta = progress - requiredToday;
	return withEstimate({
		...base, kind: total === 0 ? 'same-day' : 'scheduled', requiredToday, delta, overdue,
		requiredAverage: total > 0 ? 100 / total : undefined,
		actualAverage,
		remainingRequired: total > 0 && remaining > 0 && progress < 100 ? (100 - progress) / remaining : undefined,
		message: progress === 100 ? 'Completed' : overdue ? 'Overdue' : total === 0 ? 'Same-day target'
			: date < start ? 'Not started yet' : delta > 0 ? 'Ahead of required pace' : delta < 0 ? 'Behind required pace' : 'At required pace',
	});
}

/** A display-only projection independent of the entry's required deadline target. */
function withEstimate(pace: Pace): Pace {
	if (pace.progress > 0 && pace.progress < 100 && pace.actualAverage && pace.actualAverage > 0) {
		try {
			const remainingDays = (100 - pace.progress) / pace.actualAverage;
			pace.estimatedEnd = addDays(pace.today, Math.ceil(remainingDays));
			pace.estimatedDays = remainingDays;
			if (pace.kind === 'open-ended') pace.message = 'Estimated finish';
		} catch { if (pace.kind === 'open-ended') pace.message = 'Estimate outside supported dates'; }
	}
	return pace;
}

export function percentage(value: number): string {
	if (value > 0 && value < 0.01) return '<0.01%';
	return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

export function paceRate(value: number | undefined): string {
	return value === undefined ? 'Unavailable' : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} pp/day`;
}

/** Bounded, linear geometry; same-day schedules use a target point, never an infinite slope. */
export function paceLayout(pace: Pace, width = 409, height = 180) {
	const dates = [pace.today];
	if (pace.kind !== 'unavailable' && pace.start) dates.push(pace.start);
	if (pace.kind !== 'unavailable' && pace.deadline) dates.push(pace.deadline);
	if (pace.estimatedEnd) dates.push(pace.estimatedEnd);
	dates.sort();
	const from = dates[0]!, to = dates.at(-1)!;
	const duration = dayDifference(from, to);
	const x = (date: DateKey) => duration > 0 ? 16 + dayDifference(from, date) / duration * (width - 32) : width / 2;
	const y = (value: number) => height - 20 - value / 100 * (height - 36);
	const current = { x: x(pace.today), y: y(pace.progress) };
	const requiredPath = pace.kind === 'scheduled' ? `M ${x(pace.start!)} ${y(0)} L ${x(pace.deadline!)} ${y(100)}` : '';
	const actualPath = pace.kind !== 'unavailable' && pace.today > pace.start!
		? `M ${x(pace.start!)} ${y(0)} L ${current.x} ${current.y}` : '';
	const estimateX = pace.estimatedEnd && pace.estimatedDays !== undefined
		? current.x + pace.estimatedDays / duration * (width - 32) : undefined;
	const estimatePath = estimateX !== undefined ? `M ${current.x} ${current.y} L ${estimateX} ${y(100)}` : '';
	return { width, from, to, x, y, current, requiredPath, actualPath, estimatePath, estimateX };
}
