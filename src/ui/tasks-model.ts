import type { HeadingCache, ListItemCache } from 'obsidian';
import type { TaggedEntry } from './tagged-notes';
import { projectTaskItems } from './project-task-progress';

export interface OpenProjectTask<T> {
	file: T;
	line: number;
	sourceLine: string;
	text: string;
	heading?: string;
}

export interface ProjectTaskGroup<T> {
	project: TaggedEntry<T>;
	tasks: OpenProjectTask<T>[];
}

/** Show only a native, still-open Markdown checkbox at its cached source line. */
export function openTaskText(line: string): string | undefined {
	const match = line.match(/^(?:\s*>\s*)*\s*(?:[-+*]|\d+[.)])\s+\[ \]\s*(.*)$/);
	return match ? match[1]?.trim() || 'Untitled task' : undefined;
}

/** Each task belongs to its closest inline project, falling back to its project note. */
export function projectTaskGroups<T extends { path: string; basename: string }>(
	projects: readonly TaggedEntry<T>[],
	itemsFor: (file: T) => readonly ListItemCache[] | undefined,
	contentFor: (file: T) => string,
	headingsFor: (file: T) => readonly HeadingCache[] | undefined,
): ProjectTaskGroup<T>[] {
	const byFile = new Map<string, TaggedEntry<T>[]>();
	for (const project of projects) {
		const entries = byFile.get(project.file.path) ?? [];
		entries.push(project);
		byFile.set(project.file.path, entries);
	}
	const groups: ProjectTaskGroup<T>[] = [];
	for (const entries of byFile.values()) {
		const file = entries[0]?.file;
		if (!file) continue;
		const items = itemsFor(file);
		const headings = [...(headingsFor(file) ?? [])].sort((a, b) => a.position.start.line - b.position.start.line);
		const lines = contentFor(file).split(/\r?\n/);
		const assigned = new Map<number, TaggedEntry<T>>();
		const whole = entries.find(entry => entry.line === undefined);
		if (whole) for (const item of projectTaskItems(whole, items)) {
			assigned.set(item.position.start.line, whole);
		}
		const inline = entries.filter(entry => entry.line !== undefined).sort((a, b) =>
			(items?.find(item => item.position.start.line === (a.line ?? -1))?.position.start.col ?? 0)
			- (items?.find(item => item.position.start.line === (b.line ?? -1))?.position.start.col ?? 0)
			|| (a.line ?? 0) - (b.line ?? 0));
		for (const project of inline) for (const item of projectTaskItems(project, items)) {
			assigned.set(item.position.start.line, project);
		}
		const tasksByProject = new Map<TaggedEntry<T>, OpenProjectTask<T>[]>();
		let headingIndex = 0;
		let heading: string | undefined;
		for (const [line, project] of [...assigned].sort(([a], [b]) => a - b)) {
			while (true) {
				const nextHeading = headings[headingIndex];
				if (!nextHeading || nextHeading.position.start.line >= line) break;
				heading = nextHeading.heading.trim() || undefined;
				headingIndex++;
			}
			const sourceLine = lines[line];
			if (sourceLine === undefined) continue;
			const text = openTaskText(sourceLine);
			if (!text) continue;
			const tasks = tasksByProject.get(project) ?? [];
			tasks.push({ file, line, sourceLine, text, heading });
			tasksByProject.set(project, tasks);
		}
		for (const project of entries) {
			const tasks = tasksByProject.get(project);
			if (tasks?.length) groups.push({ project, tasks: tasks.sort((a, b) => a.line - b.line) });
		}
	}
	return groups.sort((a, b) => a.project.text.localeCompare(b.project.text, undefined, { numeric: true, sensitivity: 'base' })
		|| a.project.file.path.localeCompare(b.project.file.path) || (a.project.line ?? -1) - (b.project.line ?? -1));
}
