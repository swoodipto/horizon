import { parseDate, today } from './dates';
import type { CalendarMode, DateKey, TimelineScale } from './types';

export interface PlanningState {
	optionId: 'upcoming' | 'timeline';
	date: DateKey;
	mode: CalendarMode;
	scale: TimelineScale;
	zoom: number;
}

export const CALENDAR_MODES: { value: CalendarMode; label: string }[] = [
	{ value: 'day', label: 'Day' }, { value: 'four-days', label: '4 days' },
	{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' },
	{ value: 'year', label: 'Year' },
];
export const TIMELINE_SCALES: { value: TimelineScale; label: string }[] = [
	{ value: 'month', label: 'Month' }, { value: 'quarter', label: 'Quarter' },
	{ value: 'year', label: 'Year' }, { value: 'five-years', label: '5 years' },
];

/** A partial navigation state must preserve the view's last date and scale. */
export function planningState(value: unknown, previous?: PlanningState): PlanningState {
	const base: PlanningState = previous ?? {
		optionId: 'upcoming', date: today(), mode: 'month', scale: 'quarter', zoom: 1,
	};
	if (!value || typeof value !== 'object') return { ...base };
	const saved = value as Partial<PlanningState>;
	return {
		optionId: saved.optionId === 'timeline' || saved.optionId === 'upcoming' ? saved.optionId : base.optionId,
		date: parseDate(saved.date) ?? base.date,
		mode: CALENDAR_MODES.some(item => item.value === saved.mode) ? saved.mode! : base.mode,
		scale: TIMELINE_SCALES.some(item => item.value === saved.scale) ? saved.scale! : base.scale,
		zoom: typeof saved.zoom === 'number' && Number.isFinite(saved.zoom)
			? Math.min(8, Math.max(0.5, saved.zoom)) : base.zoom,
	};
}
