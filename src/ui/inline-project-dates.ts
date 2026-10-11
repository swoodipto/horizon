import { parseDate } from '../planning/dates';
import { projectLineSuffix, type ProjectStatusTarget } from './project-line';

export type EntryDateProperty = 'start' | 'deadline' | 'completed';
interface DateField { property: EntryDateProperty; index: number; end: number; value: string }
export interface InlineProjectDates { start?: string; deadline?: string; completed?: string; issue?: string; fields: DateField[] }

/** Only top-level fields count; code, comments, escaped brackets and link labels are literal. */
export function inlineProjectDates(line: string): InlineProjectDates {
	const fields: DateField[] = [];
	let depth = 0;
	for (let index = 0; index < line.length; index++) {
		if (line[index] === '\\') { index++; continue; }
		if (line.startsWith('<!--', index)) {
			const end = line.indexOf('-->', index + 4); if (end < 0) break; index = end + 2; continue;
		}
		if (line.startsWith('%%', index)) {
			const end = line.indexOf('%%', index + 2); if (end < 0) break; index = end + 1; continue;
		}
		if (line[index] === '`') {
			const fence = line.slice(index).match(/^`+/)?.[0] ?? '`';
			const end = line.indexOf(fence, index + fence.length);
			if (end >= 0) { index = end + fence.length - 1; continue; }
		}
		if (!depth && line[index] === '[') {
			const match = line.slice(index).match(/^\[\s*(start\s+date|deadline|completed\s+date)\s*::\s*([^\]\r\n]*)\]/i);
			if (match && !['(', '['].includes(line[index + match[0].length] ?? '')) {
				fields.push({ property: match[1]?.toLowerCase().startsWith('start') ? 'start' : match[1]?.toLowerCase().startsWith('completed') ? 'completed' : 'deadline',
					index, end: index + match[0].length, value: match[2]?.trim() ?? '' });
				index += match[0].length - 1; continue;
			}
		}
		if (line[index] === '[') depth++;
		if (line[index] === ']') depth = Math.max(0, depth - 1);
	}
	const result: InlineProjectDates = { fields };
	for (const property of ['start', 'deadline', 'completed'] as const) {
		const matches = fields.filter(field => field.property === property);
		if (matches.length > 1) result.issue = 'Repeated inline date fields. Edit the source to keep one of each.';
		else if (matches.length) {
			const value = parseDate(matches[0]?.value);
			if (value) result[property] = value;
			else result.issue = 'Invalid inline date. Use YYYY-MM-DD.';
		}
	}
	if (result.start && result.deadline && result.start > result.deadline) result.issue = 'The deadline cannot be before the start date.';
	return result;
}

export function withoutInlineProjectDates(line: string): string {
	let text = line;
	for (const field of [...inlineProjectDates(line).fields].reverse()) text = text.slice(0, field.index) + text.slice(field.end);
	return text;
}

/** Resolve only the captured exact line, including a uniquely relocated line. */
export function exactSourceLine(lines: readonly string[], target: ProjectStatusTarget): number {
	if (target.line === undefined || !Number.isInteger(target.line) || target.line < 0 || target.sourceLine === undefined) {
		throw new Error('Invalid project line.');
	}
	if (lines[target.line] === target.sourceLine) return target.line;
	const matches = lines.flatMap((line, index) => line === target.sourceLine ? [index] : []);
	if (matches.length !== 1) throw new Error('The project line changed or is ambiguous. Reopen the action and try again.');
	return matches[0] ?? -1;
}

export function setInlineProjectDate(content: string, target: ProjectStatusTarget, property: EntryDateProperty, value: string): string {
	if (value && !parseDate(value)) throw new Error('Enter a valid calendar date.');
	const parts = content.split(/(\r?\n)/);
	const index = exactSourceLine(parts.filter((_, position) => position % 2 === 0), target) * 2;
	let line = parts[index] ?? '';
	const dates = inlineProjectDates(line);
	if (dates.fields.filter(field => field.property === property).length > 1) throw new Error(dates.issue);
	const field = dates.fields.find(field => field.property === property);
	if (field) {
		let start = field.index;
		if (!value && line[start - 1] === ' ' && /\S/.test(line.slice(0, start))) start--;
		line = line.slice(0, start) + (value ? `[${property === 'start' ? 'start date' : property === 'completed' ? 'completed date' : 'deadline'}:: ${value}]` : '') + line.slice(field.end);
	} else if (value) {
		const { core, suffix, trailing } = projectLineSuffix(line);
		line = core + ` [${property === 'start' ? 'start date' : property === 'completed' ? 'completed date' : 'deadline'}:: ${value}]` + suffix + trailing;
	}
	const next = inlineProjectDates(line);
	if (next.issue && property !== 'completed') throw new Error(next.issue);
	parts[index] = line;
	return parts.join('');
}
