import type { DateKey } from '../planning/types';

export interface CurrentTimePosition {
	date: DateKey;
	column: number;
	fraction: number;
	label: string;
}

/** Local clock time is display-only; project dates remain civil all-day values. */
export function currentTimePosition(now: Date, days: readonly DateKey[]): CurrentTimePosition | undefined {
	const date = `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	const column = days.indexOf(date);
	if (column < 0) return undefined;
	const hours = now.getHours();
	const minutes = now.getMinutes();
	return {
		date,
		column,
		fraction: (hours * 60 + minutes + now.getSeconds() / 60) / 1440,
		label: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
	};
}
