import type { DateKey } from '../planning/types';

export function formatInsightAxisDate(date: DateKey): string {
	return `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}`;
}

export function formatInsightDate(date: DateKey): string {
	const value = new Date(0);
	value.setFullYear(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
	value.setHours(12, 0, 0, 0);
	return value.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function localDateAt(at: number): DateKey {
	const value = new Date(at);
	return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
