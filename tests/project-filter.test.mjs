import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { buildSync } = createRequire(import.meta.url)('esbuild');
const code = buildSync({
	stdin: { contents: `export * from './project-filter'; export * from './entry-tree';`, loader: 'ts',
		resolveDir: fileURLToPath(new URL('../src/ui/', import.meta.url)) },
	bundle: true, write: false, format: 'esm',
}).outputFiles[0].text;
const { normalizeProjectFilter, projectEntryStatus, filterProjectEntries, nestTaggedEntries, visibleEntryRelations } =
	await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

function entry(name, tags, lineTags = [], line) {
	return { file: { path: name+'.md', basename: name }, text: name, line,
		metadata: { noteTags: tags, lineTags: lineTags.map(([line, tag]) => ({ tag, position: { start: { line } } })) } };
}
const status = entry => projectEntryStatus(entry, entry.metadata);

test('todo includes notes and lines without status, legacy todo, and unrelated nested status tags', () => {
	const entries = [entry('Plain', ['project']), entry('Legacy', ['project', '#todo']),
		entry('Nested tag', ['project', 'doing/later']), entry('Done', ['project', 'completed']),
		entry('Plain line', ['project', 'completed'], [[2, '#project']], 2)];
	assert.deepEqual(filterProjectEntries(entries, 'todo', status).map(entry => entry.text),
		['Plain', 'Legacy', 'Nested tag', 'Plain line']);
});

test('inline projects use only their own line, independently of the note and adjacent lines', () => {
	const tags = [[1, '#doing'], [2, '#project'], [2, '#waiting'], [3, '#completed']];
	assert.equal(status(entry('Note', ['project', 'ready'], tags)).tag, 'ready');
	assert.equal(status(entry('Line', ['project', 'ready'], tags, 2)).tag, 'waiting');
	assert.equal(status(entry('Empty line', ['project', 'ready'], tags, 4)).tag, 'todo');
});

test('each filter uses the same effective status as the displayed icon, preserving order and identity', () => {
	const statuses = ['todo', 'backburner', 'waiting', 'discuss', 'ready', 'doing', 'completed'];
	const entries = statuses.map(tag => entry(tag, ['project', '#'+tag.toUpperCase()]));
	entries.push(entry('Conflicting old note', ['project', 'doing', 'completed']));
	for (const filter of statuses) {
		const matches = filterProjectEntries(entries, filter, status);
		assert.equal(matches[0], entries[statuses.indexOf(filter)]);
		assert.equal(matches.length, filter === 'completed' ? 2 : 1);
	}
	assert.deepEqual(filterProjectEntries(entries, 'all', status), entries);
});

test('a matching child survives a hidden parent and retains its relationship subtitle', () => {
	const parent = entry('Parent', ['project', 'completed']);
	const child = entry('Child', ['project', 'doing']);
	child.parents = [{ path: parent.file.path, name: parent.text, icon: 'circle-check-big' }];
	const roots = nestTaggedEntries(filterProjectEntries([child, parent], 'doing', status));
	assert.equal(roots.length, 1);
	assert.equal(roots[0].entry, child);
	assert.equal(roots[0].parentPath, undefined);
	assert.deepEqual(visibleEntryRelations(roots[0]), child.parents);
	parent.metadata.noteTags = ['project', 'doing'];
	const both = nestTaggedEntries(filterProjectEntries([child, parent], 'doing', status));
	assert.equal(both[0].entry, parent);
	assert.equal(both[0].children[0].entry, child);
	assert.deepEqual(visibleEntryRelations(both[0].children[0]), []);
});

test('metadata status changes remove matches and can leave an empty filtered list without mutation', () => {
	const note = entry('Work', ['project', 'doing']);
	const entries = [note];
	assert.equal(filterProjectEntries(entries, 'doing', status).length, 1);
	note.metadata.noteTags = ['project', 'completed'];
	assert.deepEqual(filterProjectEntries(entries, 'doing', status), []);
	assert.deepEqual(entries, [note]);
	assert.deepEqual(note.metadata.noteTags, ['project', 'completed']);
});

test('unknown, malformed and old saved filters restore All', () => {
	for (const value of [undefined, null, '', 'all', 'DOING', 'project', {}, ['doing']]) {
		assert.equal(normalizeProjectFilter(value), 'all');
	}
	assert.equal(normalizeProjectFilter('doing'), 'doing');
});
