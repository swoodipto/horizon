import type { App, TFile } from 'obsidian';
import type { TaggedEntry } from './tagged-notes';
import type { ProjectStatusTarget } from './project-status';
import { DATE_PROPERTIES, parseDate } from '../planning/dates';
import { inlineProjectDates, setInlineProjectDate, type EntryDateProperty } from './inline-project-dates';
import { setNoteDate } from './deadline';

export function entryDates(entry: Pick<TaggedEntry<TFile>, 'line' | 'sourceLine'>, properties?: Record<string, unknown>) {
	if (entry.line !== undefined) return inlineProjectDates(entry.sourceLine ?? '');
	return { start: parseDate(properties?.[DATE_PROPERTIES.start]), deadline: parseDate(properties?.deadline), completed: parseDate(properties?.['completed date']), issue: undefined };
}

export function dateTarget(element: HTMLElement, independent: boolean): ProjectStatusTarget | undefined {
	const path = element.getAttribute('data-note-path');
	if (!path) return undefined;
	const line = independent ? element.getAttribute('data-note-line') : null;
	return { path, line: line === null ? undefined : Number(line), sourceLine: element.getAttribute('data-source-line') ?? undefined };
}

export async function setEntryDate(app: Pick<App, 'vault' | 'fileManager'>, target: ProjectStatusTarget,
	property: EntryDateProperty, value: string): Promise<void> {
	if (target.line === undefined) return setNoteDate(app, target.path, property, value);
	const file = app.vault.getFileByPath(target.path);
	if (!file) throw new Error('The note no longer exists.');
	await app.vault.process(file, content => setInlineProjectDate(content, target, property, value));
}
