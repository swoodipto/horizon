import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { buildSync } = require('esbuild');
const source = fs.readFileSync(new URL('../src/ui/tagged-notes.ts', import.meta.url), 'utf8');
const compiled = buildSync({ stdin: { contents: source, loader: 'ts', resolveDir: fileURLToPath(new URL('../src/ui/', import.meta.url)) }, bundle: true, write: false, format: 'esm' }).outputFiles[0].text;
const { matchesTag, findTaggedNotes } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('matches exact and nested tags, including case variations, without matching prefixes', () => {
	assert.equal(matchesTag(['#area'], '#area'), true);
	assert.equal(matchesTag(['#AREA/work'], '#area'), true);
	assert.equal(matchesTag(['#areas', '#area-work', '#goal'], '#area'), false);
	assert.equal(matchesTag(['#goal/2026'], '#goal'), true);
	assert.equal(matchesTag(['#goalpost', '#goals'], '#goal'), false);
	assert.equal(matchesTag(['#PROJECT/work'], '#project'), true);
	assert.equal(matchesTag(['#projects', '#project-work'], '#project'), false);
});

test('each category lists only its tagged notes once and leaves input order intact', () => {
	const files = [
		{ basename: 'Work', path: 'Areas/Work.md', tags: ['#area', '#area/work'] },
		{ basename: 'Launch', path: 'Goals/Launch.md', tags: ['#goal'] },
		{ basename: 'Build', path: 'Projects/Build.md', tags: ['#project'] },
		{ basename: 'Health', path: 'Areas/Health.md', tags: ['#area'] },
		{ basename: 'Untagged', path: 'Untagged.md', tags: [] },
	];
	const paths = files.map(file => file.path);
	const tags = file => file.tags;
	assert.deepEqual(findTaggedNotes(files, tags, '#area').map(file => file.basename), ['Health', 'Work']);
	assert.deepEqual(findTaggedNotes(files, tags, '#goal').map(file => file.basename), ['Launch']);
	assert.deepEqual(findTaggedNotes(files, tags, '#project').map(file => file.basename), ['Build']);
	assert.deepEqual(findTaggedNotes(files, tags, '#missing'), []);
	assert.deepEqual(files.map(file => file.path), paths);
});

test('results reflect changing cached tags and retain identically named notes in different folders', () => {
	const files = [
		{ basename: 'Plan', path: 'B/Plan.md' },
		{ basename: 'Plan', path: 'A/Plan.md' },
	];
	const cache = new Map(files.map(file => [file.path, ['#goal']]));
	const tags = file => cache.get(file.path) ?? [];
	assert.deepEqual(findTaggedNotes(files, tags, '#goal').map(file => file.path), ['A/Plan.md', 'B/Plan.md']);
	cache.set('A/Plan.md', ['#area']);
	assert.deepEqual(findTaggedNotes(files, tags, '#goal').map(file => file.path), ['B/Plan.md']);
});
