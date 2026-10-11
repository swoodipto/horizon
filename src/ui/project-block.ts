import type { CachedMetadata } from 'obsidian';
import { exactSourceLine } from './inline-project-dates';
import type { ProjectStatusTarget } from './project-status';

export interface ProjectBlock { start: number; end: number; root: number; text: string; indent: string; kind: 'list' | 'heading' | 'block'; structured: boolean }

export function safeMarkdownEnd(content: string): boolean {
	let fence = ''; let comment = false; let htmlComment = false;
	for (const line of content.split(/\r?\n/)) {
		if (fence) {
			const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)?.[1];
			if (close && close[0] === fence[0] && close.length >= fence.length) fence = '';
			continue;
		}
		const opening = !comment && !htmlComment ? line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1] : undefined;
		if (opening) { fence = opening; continue; }
		const visible = line.replace(/(`+).*?\1/g, match => ' '.repeat(match.length));
		if (!fence && !htmlComment) {
			const comments = visible.match(/(?<!\\)%%/g)?.length ?? 0; if (comments % 2) comment = !comment;
		}
		if (comment) continue;
		for (const marker of visible.matchAll(/<!--|-->/g)) htmlComment = marker[0] === '<!--';
	}
	return !fence && !comment && !htmlComment;
}

/** Use cached Markdown boundaries, after validating the cached root against current text. */
export function projectBlock(content: string, target: ProjectStatusTarget, cache: CachedMetadata | null): ProjectBlock {
	const lines = content.split(/\r?\n/);
	const root = exactSourceLine(lines, target);
	if (root !== target.line || !cache) throw new Error('Project metadata changed. Reopen the view and try again.');
	const heading = cache.headings?.find(item => item.position.start.line === root);
	const listItem = cache.listItems?.find(item => item.position.start.line === root);
	let start = root; let end = root; let kind: ProjectBlock['kind'] = 'block'; let indent = ''; let structured = false;
	if (heading) {
		kind = 'heading';
		end = (cache.headings?.find(item => item.position.start.line > root && item.level <= heading.level)?.position.start.line ?? lines.length) - 1;
	} else if (listItem) {
		kind = 'list'; indent = lines[root]?.match(/^[\t ]*/)?.[0] ?? '';
		const descendants = new Set([root]);
		for (const item of cache.listItems ?? []) if (descendants.has(item.parent)) descendants.add(item.position.start.line);
		for (const item of cache.listItems ?? []) if (descendants.has(item.position.start.line)) {
			end = Math.max(end, item.position.end.line - (item.position.end.col === 0 && item.position.end.line > root ? 1 : 0));
		}
	} else {
		const section = cache.sections?.find(item => item.position.start.line <= root && item.position.end.line >= root);
		if (!section || ['code', 'yaml', 'comment'].includes(section.type)) throw new Error('This project block has no safe Markdown boundary.');
		start = section.position.start.line;
		end = section.position.end.line - (section.position.end.col === 0 && section.position.end.line > start ? 1 : 0);
		structured = ['blockquote', 'callout', 'table'].includes(section.type) || /^\s*>/.test(lines[start] ?? '');
	}
	while (end > root && !lines[end]?.trim()) end--;
	if (structured) {
		let anchor = end + 1;
		while (anchor < lines.length && !lines[anchor]?.trim()) anchor++;
		if (/^\^[A-Za-z0-9-]+\s*$/.test(lines[anchor] ?? '')) end = anchor;
	}
	const text = lines.slice(start, end + 1).join(content.includes('\r\n') ? '\r\n' : '\n');
	if (!text || !safeMarkdownEnd(text)) throw new Error('The project block has an unclosed fence or comment. Fix its Markdown before moving it.');
	return { start, end, root: root - start, text, indent, kind, structured };
}

export function topLevelBlock(block: ProjectBlock): string {
	if (!block.indent) return block.text;
	return block.text.split(/\r?\n/).map(line => line.startsWith(block.indent) ? line.slice(block.indent.length) : line).join('\n');
}
