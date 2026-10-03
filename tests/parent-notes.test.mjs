import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
const { transformSync } = createRequire(import.meta.url)('esbuild');
const source = fs.readFileSync(new URL('../src/ui/parent-notes.ts', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'esm' }).code;
const { parentNotes } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('shows the actual parent page name for wiki links, paths, aliases and headings', () => {
	const paths = [];
	const result = parentNotes('[[Areas/Freelance.md#Work|My work]]', path => {
		paths.push(path); return {name: 'Freelance', icon: 'layers-2'};
	});
	assert.deepEqual(paths, ['Areas/Freelance.md']);
	assert.deepEqual(result, [{name: 'Freelance', icon: 'layers-2'}]);
});

test('supports the nested list parsed from unquoted parent: [[Freelance]] YAML', () => {
	assert.deepEqual(parentNotes([['Freelance']], () => undefined), [{name: 'Freelance', icon: 'sticky-note'}]);
});

test('preserves resolved paths and distinguishes parents with identical page names', () => {
	const result = parentNotes(['[[Areas/Work]]', '[[Goals/Work]]', '[[Areas/Work.md]]'], path => ({
		name: 'Work', icon: 'goal', path: path.replace(/\.md$/, '') + '.md',
	}));
	assert.deepEqual(result, [
		{ name: 'Work', icon: 'goal', path: 'Areas/Work.md' },
		{ name: 'Work', icon: 'goal', path: 'Goals/Work.md' },
	]);
});

test('supports multiple parents and deduplicates equivalent resolved names', () => {
	assert.deepEqual(parentNotes(['[[Work]]', '[[Areas/Work.md]]', '[[Life]]'], path =>
		path.includes('Work') ? {name: 'Work', icon: 'goal'} : undefined), [{name: 'Work', icon: 'goal'}, {name: 'Life', icon: 'sticky-note'}]);
});

test('missing and unsupported properties have no subtitle; unresolved links retain the page name', () => {
	for (const value of [undefined, null, '', 42, {}, [null, false]]) {
		assert.deepEqual(parentNotes(value, () => assert.fail('No link to resolve')), []);
	}
	assert.deepEqual(parentNotes('[[Areas/Freelance.md]]', () => undefined), [{name: 'Freelance', icon: 'sticky-note'}]);
});
