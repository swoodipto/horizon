import type { App } from 'obsidian';
import { today } from '../planning/dates';
import { exactSourceLine, inlineProjectDates, setInlineProjectDate } from './inline-project-dates';
import { projectLineSuffix, type ProjectStatusTarget } from './project-line';
import { hasCategoryTag, hasCompletionTag, propertyTags, sourceTags, visibleTagText } from './completion-tags';
export { projectLineSuffix, type ProjectStatusTarget } from './project-line';

export const PROJECT_STATUSES = [
	{ tag: 'todo', icon: 'circle-small' },
	{ tag: 'backburner', icon: 'circle-stop' },
	{ tag: 'waiting', icon: 'clock' },
	{ tag: 'discuss', icon: 'at-sign' },
	{ tag: 'ready', icon: 'circle' },
	{ tag: 'doing', icon: 'circle-chevron-right' },
	{ tag: 'someday', icon: 'circle-dashed' },
	{ tag: 'completed', icon: 'circle-check-big' },
] as const;

/** Existing multi-status notes use their last explicit status; no status means todo. */
export function projectStatusForTags(tags: readonly string[]): typeof PROJECT_STATUSES[number] {
	for (const tag of [...tags].reverse()) {
		const normalized = tag.replace(/^#/, '').toLocaleLowerCase();
		const status = PROJECT_STATUSES.find(item => item.tag !== 'todo' && item.tag === normalized);
		if (status) return status;
	}
	return PROJECT_STATUSES[0];
}

export function setPropertyTag(value: unknown, tag: string): string[] {
	const tags = propertyTags(value);
	const keepGoal = tag !== 'todo' && tag !== 'completed' && hasCategoryTag(tags, 'goal') && hasCompletionTag(tags);
	const unrelated = tags.filter(item => !PROJECT_STATUSES.some(status =>
		status.tag === item.replace(/^#/, '').toLocaleLowerCase()) || (keepGoal && item.replace(/^#/, '').toLowerCase() === 'completed'));
	if (tag !== 'todo') unrelated.push(tag);
	return unrelated;
}

/** Change only the selected source line; preserve line endings and other content. */
function changeLineStatus(content: string, target: ProjectStatusTarget, tag: string): string {
	if (!Number.isInteger(target.line) || target.line === undefined || target.line < 0 || target.sourceLine === undefined) {
		throw new Error('Invalid project line.');
	}
	const parts = content.split(/(\r?\n)/);
	let index = target.line * 2;
	if (parts[index] !== target.sourceLine) {
		const matches: number[] = [];
		for (let i = 0; i < parts.length; i += 2) if (parts[i] === target.sourceLine) matches.push(i);
		if (matches.length !== 1) throw new Error('The project line changed. Reopen the menu and try again.');
		index = matches[0] ?? -1;
	}
	const line = parts[index];
	if (line === undefined) throw new Error('The project line no longer exists.');
	// Literal tags inside inline code do not count as an existing status.
	const { core: body, suffix, trailing } = projectLineSuffix(line);
	let core = body;
	// Mask code with spaces to preserve the original character positions.
	const visible = visibleTagText(core);
	const names = PROJECT_STATUSES.map(status => status.tag).join('|');
	const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_/#-])#(${names})(?![\\p{L}\\p{N}_/-])`, 'giu');
	const keepGoal = tag !== 'todo' && tag !== 'completed' && hasCategoryTag(sourceTags(line), 'goal') && hasCompletionTag(sourceTags(line));
	const matches = [...visible.matchAll(pattern)].filter(match => !keepGoal || match[2]?.toLowerCase() !== 'completed');
	if (tag === 'todo' && !matches.length) return content;
	if (tag !== 'todo' && matches.length === 1 && matches[0]?.[2]?.toLocaleLowerCase() === tag) return content;
	for (const match of matches.reverse()) {
		let start = (match.index ?? 0) + (match[1]?.length ?? 0);
		let end = start + (match[2]?.length ?? 0) + 1;
		// Remove the tag's separating space while retaining list indentation.
		if (core[start - 1] === ' ' && /\S/.test(core.slice(0, start))) start--;
		else if (core[end] === ' ') end++;
		core = core.slice(0, start) + core.slice(end);
	}
	parts[index] = `${core}${tag === 'todo' ? '' : ` #${tag}`}${suffix}${trailing}`;
	return parts.join('');
}

/** Native APIs handle property serialization and atomic line updates. */
export async function setProjectStatus(
	app: Pick<App, 'vault' | 'fileManager'>,
	target: ProjectStatusTarget,
	tag: string,
): Promise<void> {
	if (!PROJECT_STATUSES.some(status => status.tag === tag)) throw new Error('Unknown project status.');
	const file = app.vault.getFileByPath(target.path);
	if (!file) throw new Error('The note no longer exists.');
	if (target.line === undefined) {
		await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			setProjectProperties(frontmatter, tag);
		});
	} else {
		await app.vault.process(file, content => setLineStatus(content, target, tag));
	}
}

/** Completion date belongs to the entry, shared by dual category occurrences. */
export function updateCompletionDate(properties: Record<string, unknown>, before: readonly string[], after: readonly string[]): void {
	const was = (hasCategoryTag(before, 'goal') && hasCompletionTag(before)) || projectStatusForTags(before).tag === 'completed';
	const next = (hasCategoryTag(after, 'goal') && hasCompletionTag(after)) || projectStatusForTags(after).tag === 'completed';
	if (next && !was) properties['completed date'] = today();
	else if (!next && was) delete properties['completed date'];
}

export function setProjectProperties(properties: Record<string, unknown>, tag: string): void {
	const before = propertyTags(properties.tags);
	const after = setPropertyTag(properties.tags, tag);
	updateCompletionDate(properties, before, after);
	properties.tags = after;
}

export function setLineStatus(content: string, target: ProjectStatusTarget, tag: string): string {
	const index = exactSourceLine(content.split(/\r?\n/), target);
	const changed = changeLineStatus(content, target, tag);
	const line = changed.split(/\r?\n/)[index];
	if (line === undefined) throw new Error('The project line no longer exists.');
	const before = sourceTags(target.sourceLine ?? '');
	const dates = inlineProjectDates(target.sourceLine ?? '');
	const properties: Record<string, unknown> = { 'completed date': dates.completed };
	updateCompletionDate(properties, before, sourceTags(line));
	if (properties['completed date'] === dates.completed) return changed;
	return setInlineProjectDate(changed, { ...target, line: index, sourceLine: line }, 'completed', typeof properties['completed date'] === 'string' ? properties['completed date'] : '');
}
