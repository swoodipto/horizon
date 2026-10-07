import { addDays, dayDifference, parseDate, today } from '../planning/dates';
import type { DateKey } from '../planning/types';

export interface GoalForecastInput {
	scope: number;
	unstarted: number;
	started: number;
	completed: number;
	progress: number;
	start?: unknown;
	deadline?: unknown;
}

export type GoalForecast = {
	kind: 'estimate';
	start: DateKey;
	deadline: DateKey;
	anchor: DateKey;
	finish: DateKey;
	earlier: DateKey;
	later: DateKey;
	/** Planned work items per week, not observed delivery speed. */
	velocity: number;
	/** Effective remaining calendar days before inclusive endpoint rounding. */
	duration: number;
} | {
	kind: 'unavailable' | 'completed';
	message: string;
	start?: DateKey;
	deadline?: DateKey;
};

function hasDate(value: unknown): boolean {
	return value !== undefined && value !== null && value !== '';
}

/** Pure, display-only projection from the current snapshot and its own schedule. */
export function goalForecast(input: GoalForecastInput, date: DateKey = today()): GoalForecast {
	const start = parseDate(input.start);
	const deadline = parseDate(input.deadline);
	// Retain independently valid endpoints for chart markers, even without an estimate.
	const dates = { ...(start ? { start } : {}), ...(deadline ? { deadline } : {}) };
	const unavailable = (message: string): GoalForecast => ({ kind: 'unavailable', message, ...dates });
	const counts = [input.scope, input.unstarted, input.started, input.completed];
	const total = input.unstarted + input.started + input.completed;
	if (counts.some(value => !Number.isSafeInteger(value) || value < 0) ||
		!Number.isSafeInteger(total) || total !== input.scope ||
		!Number.isFinite(input.progress) || input.progress < 0 || input.progress > 100) {
		return unavailable('Estimate unavailable');
	}
	if (input.scope === 0) return unavailable('No work to estimate');
	if (input.progress === 100 || input.completed === input.scope) {
		return { kind: 'completed', message: 'Completed', ...dates };
	}
	if ((!start && hasDate(input.start)) || (!deadline && hasDate(input.deadline))) {
		return unavailable('Fix goal dates');
	}
	if (!start && !deadline) return unavailable('Add a start date and deadline');
	if (!start) return unavailable('Add a start date');
	if (!deadline) return unavailable('Add a deadline');
	if (deadline < start) return unavailable('Deadline precedes start date');
	const current = parseDate(date);
	if (!current) return unavailable('Estimate unavailable');

	try {
		const scheduledDays = dayDifference(start, deadline) + 1;
		const velocity = 7 * input.scope / scheduledDays;
		const remaining = input.unstarted + 0.25 * input.started;
		// Multiply before dividing to avoid spurious extra days for whole-day durations.
		const duration = remaining * scheduledDays / input.scope;
		if (!Number.isFinite(velocity) || velocity <= 0 || !Number.isFinite(duration) || duration <= 0) {
			return unavailable('Estimate unavailable');
		}
		const anchor = current > start ? current : start;
		const finishAfter = (days: number): DateKey => addDays(anchor, Math.max(0, Math.ceil(days) - 1));
		return {
			kind: 'estimate', start, deadline, anchor, velocity, duration,
			finish: finishAfter(duration),
			earlier: finishAfter(0.6 * duration),
			later: finishAfter(1.4 * duration),
		};
	} catch {
		// A scenario endpoint may overflow the shared helpers' civil-date range.
		return unavailable('Estimate unavailable');
	}
}
