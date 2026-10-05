import type { App } from 'obsidian';
import { DATE_PROPERTIES, dayDifference, parseDate, today } from '../planning/dates';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format civil dates without locale or timezone shifts. */
export function formatDeadline(value: unknown): string | undefined {
	const date = parseDate(value);
	if (!date) return undefined;
	return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

export function formatStartDate(value: unknown): string | undefined {
	const date = parseDate(value);
	if (!date) return undefined;
	return `${Number(date.slice(8, 10))}. ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

export function deadlineDaysLeft(value: unknown, currentDate = today()): string | undefined {
	const date = parseDate(value);
	if (!date) return undefined;
	const days = dayDifference(currentDate, date);
	if (days === 0) return 'today';
	if (days > 0) return `${days}d left`;
	return `${Math.abs(days)}d overdue`;
}

/** Update only the existing deadline property using Obsidian's serializer. */
export async function setDeadline(app: Pick<App, 'vault' | 'fileManager'>, path: string, value: string): Promise<void> {
	await setNoteDate(app, path, 'deadline', value);
}

export async function setNoteDate(app: Pick<App, 'vault' | 'fileManager'>, path: string,
	property: 'start' | 'deadline', value: string): Promise<void> {
	const date = value === '' ? undefined : parseDate(value);
	if (value && !date) throw new Error('Enter a valid calendar date.');
	const file = app.vault.getFileByPath(path);
	if (!file) throw new Error('The note no longer exists.');
	await app.fileManager.processFrontMatter(file, (properties: Record<string, unknown>) => {
		const start = parseDate(properties[DATE_PROPERTIES.start]);
		const deadline = parseDate(properties.deadline);
		if (date && ((property === 'deadline' && start && date < start) ||
			(property === 'start' && deadline && date > deadline))) {
			throw new Error('The deadline cannot be before the start date.');
		}
		if (date) properties[DATE_PROPERTIES[property]] = date;
		else delete properties[DATE_PROPERTIES[property]];
	});
}
