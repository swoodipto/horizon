import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
const { transformSync } = createRequire(import.meta.url)('esbuild');
async function load(file) {
	const code = transformSync(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' }).code;
	return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { normalizeSettings, DEFAULT_SETTINGS } = await load('../src/settings.ts');
const { openNoteInCurrentTab } = await load('../src/ui/open-note.ts');

test('uses theme width by default and restores saved custom-width preferences', () => {
	assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
	assert.deepEqual(normalizeSettings({ useThemeContentWidth: false, customContentWidth: 920 }), {
		useThemeContentWidth: false, customContentWidth: 920,
	});
});
test('invalid stored widths and toggle values fall back to defaults', () => {
	for (const width of [null, '900', -1, 0, 199, 4001, Infinity, NaN]) {
		assert.deepEqual(normalizeSettings({ useThemeContentWidth: 'false', customContentWidth: width }), DEFAULT_SETTINGS);
	}
});
test('opens the exact file on the provided results leaf without selecting another tab', async () => {
	const file = { path: 'Areas/Client.md' };
	const vault = { getFileByPath(path) { assert.equal(path, file.path); return file; } };
	const calls = [];
	const currentLeaf = { async openFile(target) { calls.push(target); } };
	await openNoteInCurrentTab(vault, currentLeaf, file.path);
	assert.deepEqual(calls, [file]);
});
test('a deleted note does not create a new empty file or navigate', async () => {
	const vault = { getFileByPath() { return null; } };
	const currentLeaf = { async openFile() { assert.fail('Should not navigate for a missing file'); } };
	await assert.rejects(openNoteInCurrentTab(vault, currentLeaf, 'deleted.md'), /no longer exists/);
});

test('line entries open the same leaf with the exact zero-based line and focus, preserving note mode', async () => {
	const file = { path: 'finance.md' };
	const calls = [];
	const vault = { getFileByPath: () => file };
	const leaf = { async openFile(...args) { calls.push(args); } };
	await openNoteInCurrentTab(vault, leaf, file.path, 0);
	await openNoteInCurrentTab(vault, leaf, file.path, 37);
	assert.deepEqual(calls, [
		[file, { active: true, eState: { line: 0, focus: true } }],
		[file, { active: true, eState: { line: 37, focus: true } }],
	]);
});

test('invalid line positions never navigate', async () => {
	const vault = { getFileByPath: () => ({ path: 'finance.md' }) };
	const leaf = { async openFile() { assert.fail('Invalid line should not navigate'); } };
	for (const line of [-1, 0.5, NaN, Infinity]) {
		await assert.rejects(openNoteInCurrentTab(vault, leaf, 'finance.md', line), /Invalid note line/);
	}
});
