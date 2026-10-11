import type { App } from 'obsidian';
import { hasCategoryTag, hasCompletionTag, propertyTags, sourceTags, visibleTagText } from './completion-tags';
import { PROJECT_STATUSES, updateCompletionDate } from './project-status';
import { projectLineSuffix, type ProjectStatusTarget } from './project-line';
import { exactSourceLine, inlineProjectDates, setInlineProjectDate } from './inline-project-dates';

export function goalCompletionTags(tags: readonly string[], complete: boolean): string[] {
	const result = tags.filter(tag => tag.replace(/^#/, '').toLowerCase() !== 'completed');
	if (!complete) return result;
	const index = hasCategoryTag(tags, 'project') ? result.findIndex(tag => PROJECT_STATUSES.some(status => status.tag !== 'todo' && status.tag === tag.replace(/^#/, '').toLowerCase())) : -1;
	result.splice(index < 0 ? result.length : index, 0, 'completed');
	return result;
}

export function setLineGoalCompletion(content: string, target: ProjectStatusTarget, complete: boolean): string {
	const parts = content.split(/(\r?\n)/);
	const index = exactSourceLine(parts.filter((_, position) => position % 2 === 0), target);
	const original = parts[index * 2] ?? '';
	const before = sourceTags(original);
	if (!hasCategoryTag(before, 'goal')) throw new Error('The goal changed. Reopen the action and try again.');
	if (hasCompletionTag(before) === complete) return content;
	let line = original;
	const matches = [...visibleTagText(line).matchAll(/(^|[^\p{L}\p{N}_/#-])#completed(?![\p{L}\p{N}_/-])/giu)];
	for (const match of matches.reverse()) {
		let start = (match.index ?? 0) + (match[1]?.length ?? 0);
		let end = start + '#completed'.length;
		if (line[start - 1] === ' ' && /\S/.test(line.slice(0, start))) start--;
		else if (line[end] === ' ') end++;
		line = line.slice(0, start) + line.slice(end);
	}
	if (complete) {
		const statusPattern = new RegExp(`(^|[^\\p{L}\\p{N}_/#-])#(${PROJECT_STATUSES.filter(item => item.tag !== 'todo').map(item => item.tag).join('|')})(?![\\p{L}\\p{N}_/-])`, 'giu');
		const status = hasCategoryTag(before, 'project') ? [...visibleTagText(line).matchAll(statusPattern)][0] : undefined;
		if (status) {
			const position = (status.index ?? 0) + (status[1]?.length ?? 0);
			line = line.slice(0, position) + '#completed ' + line.slice(position);
		} else {
			const { core, suffix, trailing } = projectLineSuffix(line);
			line = `${core} #completed${suffix}${trailing}`;
		}
	}
	parts[index * 2] = line;
	const properties: Record<string, unknown> = { 'completed date': inlineProjectDates(original).completed };
	updateCompletionDate(properties, before, sourceTags(line));
	return setInlineProjectDate(parts.join(''), { ...target, line: index, sourceLine: line }, 'completed', typeof properties['completed date'] === 'string' ? properties['completed date'] : '');
}

export async function setGoalCompletion(app: Pick<App, 'vault' | 'fileManager'>, target: ProjectStatusTarget, complete: boolean): Promise<void> {
	const file = app.vault.getFileByPath(target.path);
	if (!file) throw new Error('The note no longer exists.');
	if (target.line !== undefined) {
		await app.vault.process(file, content => setLineGoalCompletion(content, target, complete));
		return;
	}
	await app.fileManager.processFrontMatter(file, (properties: Record<string, unknown>) => {
		const before = propertyTags(properties.tags);
		if (!hasCategoryTag(before, 'goal')) throw new Error('The goal changed. Reopen the action and try again.');
		if (hasCompletionTag(before) === complete) return;
		const after = goalCompletionTags(before, complete);
		updateCompletionDate(properties, before, after);
		properties.tags = after;
	});
}
