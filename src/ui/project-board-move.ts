import { parseFrontMatterTags, type App } from 'obsidian';
import { FLAT_LANE, NO_PARENT, type BoardCard, type BoardLane, type BoardStatus } from './project-board-model';
import { matchesTag } from './tagged-notes';
import { PROJECT_STATUSES, projectStatusForTags, setLineStatus, setProjectStatus, setProjectProperties } from './project-status';
import { relationValues } from './note-relations';
import { projectBlock, safeMarkdownEnd, topLevelBlock, type ProjectBlock } from './project-block';
import { moveProjectBlock, type TextPatch } from './project-transfer';
import type { NoteActionHistory } from './note-action-history';

export interface PreparedBoardMove { card: BoardCard; parent: unknown; block?: ProjectBlock; blockIssue?: string }
type BoardApp = Pick<App, 'vault' | 'metadataCache' | 'fileManager'>;
const target = (card: BoardCard) => ({ path: card.entry.file.path, line: card.entry.line, sourceLine: card.entry.sourceLine });

export async function prepareBoardMove(app: BoardApp, card: BoardCard): Promise<PreparedBoardMove> {
	const prepared: PreparedBoardMove = { card, parent: structuredClone(app.metadataCache.getFileCache(card.entry.file)?.frontmatter?.parent) };
	if (card.entry.line !== undefined) {
		try { prepared.block = projectBlock(await app.vault.read(card.entry.file), target(card), app.metadataCache.getFileCache(card.entry.file)); }
		catch (cause: unknown) { prepared.blockIssue = cause instanceof Error ? cause.message : 'Could not read the project block.'; }
	}
	return prepared;
}

function resolvedPath(app: BoardApp, value: string, source: string): string | undefined {
	const link = value.replace(/^\[\[|\]\]$/g, '').split('|')[0]?.split('#')[0]?.trim() ?? '';
	return app.metadataCache.getFirstLinkpathDest(link, source)?.path;
}

function validateParent(app: BoardApp, path: string, destination: string): void {
	const pending = [destination]; const visited = new Set<string>();
	while (pending.length) {
		const current = pending.pop(); if (!current || visited.has(current)) continue;
		if (current === path) throw new Error('This parent would create a cycle. Choose another lane.');
		visited.add(current);
		const file = app.vault.getFileByPath(current); if (!file) continue;
		for (const value of relationValues(app.metadataCache.getFileCache(file)?.frontmatter?.parent)) {
			const parent = resolvedPath(app, value, current); if (parent) pending.push(parent);
		}
	}
}

function transferPatches(app: BoardApp, prepared: PreparedBoardMove, destination: string, destinationContent: string, status: BoardStatus): { source: TextPatch; destination: TextPatch } {
	const { card, block } = prepared;
	if (!block) throw new Error(prepared.blockIssue ?? 'The source block is unavailable.');
	if (!safeMarkdownEnd(destinationContent)) throw new Error('The destination has an unclosed fence or comment. Fix its Markdown before moving the project.');
	const newline = destinationContent.includes('\r\n') ? '\r\n' : '\n';
	let moved = topLevelBlock(block).replace(/\r?\n/g, '\n');
	const root = moved.split('\n')[block.root];
	if (root === undefined) throw new Error('The project block changed.');
	moved = setLineStatus(moved, { path: destination, line: block.root, sourceLine: root }, status);
	const ids = [...moved.matchAll(/(?:^|\s)\^([A-Za-z0-9-]+)(?=\s|$)/g)].map(match => match[1] ?? '');
	for (const id of ids) if (new RegExp(`(?:^|\\s)\\^${id}(?=\\s|$)`).test(destinationContent)) {
		throw new Error('A block identifier already exists in the destination. Rename it before moving the project.');
	}
	// Paragraph anchors belong at the paragraph end; structured blocks use their own line.
	const anchorLine = block.kind === 'block' ? moved.split('\n').length - 1 : block.root;
	const rootId = moved.split('\n')[anchorLine]?.match(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/)?.[1];
	const id = rootId ?? `horizon-${Array.from(crypto.getRandomValues(new Uint32Array(3)), value => value.toString(16)).join('-')}`;
	if (!rootId) {
		if (!block.structured) {
			const lines = moved.split('\n'); lines[anchorLine] = `${lines[anchorLine] ?? ''} ^${id}`; moved = lines.join('\n');
		} else moved += `\n\n^${id}`;
	}
	const related = app.vault.getFileByPath(destination); if (!related) throw new Error('The destination note no longer exists.');
	const label = card.entry.text.replace(/[[\]|\r\n]/g, '').replace(/#project(?:\/[\w/-]+)?/gi, '').trim() || 'Moved project';
	const link = app.fileManager.generateMarkdownLink(related, card.entry.file.path, `#^${id}`, label);
	const originalRoot = block.text.split(/\r?\n/)[block.root] ?? '';
	const prefix = block.kind === 'list' ? originalRoot.match(/^([\t ]*(?:[-+*]|\d+[.)])\s+)/)?.[1] ?? ''
		: block.kind === 'heading' ? originalRoot.match(/^(#{1,6}\s+)/)?.[1] ?? '# ' : '';
	const placeholder = `${prefix}${link}${rootId ? ` ^${rootId}` : ''}`;
	const insertion = `${destinationContent ? destinationContent.endsWith(newline + newline) ? '' : destinationContent.endsWith(newline) ? newline : newline + newline : ''}${moved.replace(/\n/g, newline)}${newline}`;
	return { source: { path: card.entry.file.path, before: block.text, after: placeholder, index: -1 },
		destination: { path: destination, before: '', after: insertion, index: destinationContent.length, prefix: destinationContent.slice(-256) } };
}

export async function applyBoardMove(app: BoardApp, history: NoteActionHistory, prepared: PreparedBoardMove, lane: BoardLane, status: BoardStatus): Promise<{ path: string; line?: number } | undefined> {
	if (!PROJECT_STATUSES.some(item => item.tag === status)) throw new Error('Unknown project status.');
	const { card } = prepared;
	const crossLane = lane.id !== FLAT_LANE && lane.id !== card.lane.id;
	if (!crossLane && card.status === status) return;
	if (card.entry.line !== undefined && crossLane) {
		if (!lane.path || lane.path === card.entry.file.path) throw new Error('Choose a different note lane. Inline projects cannot move into No parent.');
		const file = app.vault.getFileByPath(lane.path); if (!file) throw new Error('The destination note no longer exists.');
		const content = await app.vault.read(file);
		const patches = transferPatches(app, prepared, lane.path, content, status);
		await history.recordTransfer(() => moveProjectBlock(app, patches.source, patches.destination));
		const leading = patches.destination.after.match(/^(?:\r?\n)*/)?.[0].match(/\n/g)?.length ?? 0;
		return { path: lane.path, line: (content.match(/\n/g)?.length ?? 0) + leading + (prepared.block?.root ?? 0) };
	}
	await history.record(async tracked => {
		if (card.entry.line !== undefined) return setProjectStatus(tracked, target(card), status);
		const file = tracked.vault.getFileByPath(card.entry.file.path); if (!file) throw new Error('The project no longer exists.');
		if (crossLane && lane.id !== NO_PARENT) {
			if (!lane.path || !app.vault.getFileByPath(lane.path)) throw new Error('Choose an existing parent note.');
			validateParent(app, file.path, lane.path);
		}
		await tracked.fileManager.processFrontMatter(file, (properties: Record<string, unknown>) => {
			const tags = parseFrontMatterTags(properties) ?? [];
			if (!matchesTag(tags, '#project') || projectStatusForTags(tags).tag !== card.status ||
				(crossLane && JSON.stringify(properties.parent) !== JSON.stringify(prepared.parent))) throw new Error('The project changed. Reopen the action and try again.');
			if (crossLane) {
				const values = relationValues(properties.parent);
				if (lane.id === NO_PARENT) delete properties.parent;
				else {
					if (card.lane.id.startsWith('unresolved:')) throw new Error('Resolve the current parent before moving between lanes.');
					const keep = values.filter(value => resolvedPath(app, value, file.path) !== card.lane.path);
					if (!keep.some(value => resolvedPath(app, value, file.path) === lane.path)) keep.push(`[[${lane.path?.replace(/\.md$/i, '')}]]`);
					properties.parent = keep;
				}
			}
			if (status !== card.status) setProjectProperties(properties, status);
		});
	});
	return { path: card.entry.file.path, line: card.entry.line };
}
