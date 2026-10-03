import type { TagCache } from 'obsidian';
import type { ParentNote } from './parent-notes';
import { GOALS_ICON } from './icon-ids';
import { projectStatusForTags } from './project-status';

export interface TaggedMetadata {
	noteTags: readonly string[];
	lineTags: readonly TagCache[];
	parents?: readonly ParentNote[];
	dependents?: readonly ParentNote[];
}

export interface TaggedEntry<T> {
	file: T;
	text: string;
	subtitle?: string;
	parents?: readonly ParentNote[];
	dependents?: readonly ParentNote[];
	line?: number;
	sourceLine?: string;
}

/** Match a tag and its nested tags without matching similarly named tags. */
export function matchesTag(tags: readonly string[], target: string): boolean {
	const normalized = target.toLocaleLowerCase();
	return tags.some((tag) => {
		const candidate = tag.toLocaleLowerCase();
		return candidate === normalized || candidate.startsWith(`${normalized}/`);
	});
}

/** A note's type comes from its property tags; inline tags identify individual lines. */
export function iconForNoteTags(tags: readonly string[]): string {
	if (matchesTag(tags, '#area')) return 'layers-2';
	if (matchesTag(tags, '#goal')) return GOALS_ICON;
	if (matchesTag(tags, '#project')) return projectStatusForTags(tags).icon;
	return 'sticky-note';
}

export function findTaggedNotes<T extends { basename: string; path: string }>(
	files: readonly T[],
	getTags: (file: T) => readonly string[],
	tag: string,
): T[] {
	return files.filter((file) => matchesTag(getTags(file), tag)).sort((a, b) =>
		a.basename.localeCompare(b.basename, undefined, { numeric: true, sensitivity: 'base' })
		|| a.path.localeCompare(b.path),
	);
}

/** Property tags represent the note; inline tags represent their own source line. */
export async function findTaggedEntries<T extends { basename: string; path: string }>(
	files: readonly T[],
	getMetadata: (file: T) => TaggedMetadata | null,
	readContent: (file: T) => Promise<string>,
	tag: string,
): Promise<TaggedEntry<T>[]> {
	const groups = await Promise.all(files.map(async (file): Promise<TaggedEntry<T>[]> => {
		const metadata = getMetadata(file);
		if (!metadata) return [];
		const entries: TaggedEntry<T>[] = [];
		if (matchesTag(metadata.noteTags, tag)) {
			const entry: TaggedEntry<T> = { file, text: file.basename };
			if (metadata.parents?.length) {
				entry.parents = metadata.parents;
			}
			if (metadata.dependents?.length) entry.dependents = metadata.dependents;
			const relations = [...entry.parents ?? [], ...entry.dependents ?? []];
			if (relations.length) entry.subtitle = relations.map(relation => relation.name).join(', ');
			entries.push(entry);
		}
		const inline = metadata.lineTags.filter(item => matchesTag([item.tag], tag));
		if (!inline.length) return entries;
		const lines = (await readContent(file)).split(/\r?\n/);
		const byLine = new Map<number, TagCache[]>();
		for (const item of inline) {
			const line = item.position.start.line;
			const tags = byLine.get(line) ?? [];
			tags.push(item);
			byLine.set(line, tags);
		}
		for (const [line, tags] of byLine) {
			let text = lines[line];
			if (text === undefined) continue;
			const sourceLine = text;
			// Remove matching tags from right to left so cached columns remain valid.
			for (const item of tags.sort((a, b) => b.position.start.col - a.position.start.col)) {
				text = text.slice(0, item.position.start.col) + text.slice(item.position.end.col);
			}
			text = text.trim().replace(/^(?:>\s*)+/, '')
				.replace(/^(?:[-+*]|\d+[.)])\s+/, '').replace(/^\[[ xX]\]\s*/, '')
				.replace(/^#{1,6}\s+/, '').replace(/[\t ]{2,}/g, ' ').trim();
			const entry: TaggedEntry<T> = { file, text: text || tag, subtitle: file.basename, line };
			if (tag.toLocaleLowerCase() === '#project') entry.sourceLine = sourceLine;
			entries.push(entry);
		}
		return entries;
	}));
	return groups.flat().sort((a, b) =>
		a.text.localeCompare(b.text, undefined, { numeric: true, sensitivity: 'base' })
		|| a.file.path.localeCompare(b.file.path) || (a.line ?? -1) - (b.line ?? -1),
	);
}
