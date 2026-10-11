import type { App } from 'obsidian';
import { safeMarkdownEnd } from './project-block';

export interface TextPatch { path: string; before: string; after: string; index: number; prefix?: string }
type TransferApp = Pick<App, 'vault'>;
const activeTransfers = new WeakMap<object, Set<string>>();

export function patchText(content: string, patch: TextPatch, reverse = false): string {
	const expected = reverse ? patch.after : patch.before;
	const replacement = reverse ? patch.before : patch.after;
	let index = patch.index;
	if (!expected) {
		if (!patch.prefix) { if (content !== '') throw new Error('The insertion location changed.'); index = 0; }
		else {
			const first = content.indexOf(patch.prefix);
			if (first < 0 || content.indexOf(patch.prefix, first + 1) >= 0) throw new Error('The insertion location changed or is ambiguous.');
			index = first + patch.prefix.length;
			if (index !== content.length) throw new Error('The destination end changed. Reopen the action and try again.');
		}
	} else if (content.slice(index, index + expected.length) !== expected) {
		index = content.indexOf(expected);
		if (index < 0 || content.indexOf(expected, index + 1) >= 0) throw new Error('The moved content changed or is ambiguous.');
	}
	return content.slice(0, index) + replacement + content.slice(index + expected.length);
}

async function applyPatch(app: TransferApp, patch: TextPatch, reverse: boolean): Promise<void> {
	const file = app.vault.getFileByPath(patch.path);
	if (!file) throw new Error('A project note no longer exists.');
	await app.vault.process(file, content => {
		if ((!reverse && !patch.before) || (reverse && !patch.after)) {
			if (!safeMarkdownEnd(content)) throw new Error('The destination has an unclosed fence or comment.');
		}
		return patchText(content, patch, reverse);
	});
}

/** Restore/insert content first; remove/replace its old copy only after that succeeds. */
async function transferContent(app: TransferApp, first: TextPatch, second: TextPatch, reverse: boolean): Promise<void> {
	const files = [first, second].map(patch => app.vault.getFileByPath(patch.path));
	if (!files[0] || !files[1]) throw new Error('A project note no longer exists.');
	const contents = await Promise.all(files.map(file => app.vault.read(file!)));
	patchText(contents[0] ?? '', first, reverse);
	patchText(contents[1] ?? '', second, reverse);
	await applyPatch(app, first, reverse);
	try { await applyPatch(app, second, reverse); }
	catch (cause: unknown) {
		const file = app.vault.getFileByPath(second.path);
		const content = file ? await app.vault.read(file).catch(() => undefined) : undefined;
		const expected = reverse ? second.after : second.before;
		const applied = reverse ? second.before : second.after;
		// A write may have reached storage before its promise failed. Preserve both if uncertain.
		if (applied && expected && content !== undefined && content.includes(applied) && !content.includes(expected)) return;
		if (content !== undefined && content.includes(expected)) {
			try { await applyPatch(app, first, !reverse); }
			catch { throw new Error('The move stopped and a copy remains in both notes. Review both locations before retrying.'); }
			throw cause;
		}
		throw new Error('The move stopped after another edit. Content was kept in the destination; review both notes before retrying.');
	}
}

async function transfer(app: TransferApp, first: TextPatch, second: TextPatch, reverse: boolean): Promise<void> {
	if (first.path === second.path) throw new Error('Choose a different destination note.');
	const locked = activeTransfers.get(app.vault) ?? new Set<string>();
	if (locked.has(first.path) || locked.has(second.path)) throw new Error('Wait for the current move to finish.');
	activeTransfers.set(app.vault, locked); locked.add(first.path); locked.add(second.path);
	try { await transferContent(app, first, second, reverse); }
	finally { locked.delete(first.path); locked.delete(second.path); }
}

export async function moveProjectBlock(app: TransferApp, source: TextPatch, destination: TextPatch) {
	await transfer(app, destination, source, false);
	return { undo: () => transfer(app, source, destination, true), redo: () => transfer(app, destination, source, false) };
}
