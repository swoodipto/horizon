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
const { normalizeProjectFilter, toggleProjectFilter, selectProjectFilter, availableProjectStatuses, reconcileProjectFilter, projectFilterLabel, projectEntryStatus, filterProjectEntries, nestTaggedEntries, visibleEntryRelations } =
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
	assert.deepEqual(filterProjectEntries(entries, ['todo'], status).map(entry => entry.text),
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
		const matches = filterProjectEntries(entries, [filter], status);
		assert.equal(matches[0], entries[statuses.indexOf(filter)]);
		assert.equal(matches.length, filter === 'completed' ? 2 : 1);
	}
	assert.deepEqual(filterProjectEntries(entries, 'all', status), entries);
});

test('a matching child survives a hidden parent and retains its relationship subtitle', () => {
	const parent = entry('Parent', ['project', 'completed']);
	const child = entry('Child', ['project', 'doing']);
	child.parents = [{ path: parent.file.path, name: parent.text, icon: 'circle-check-big' }];
	const roots = nestTaggedEntries(filterProjectEntries([child, parent], ['doing'], status));
	assert.equal(roots.length, 1);
	assert.equal(roots[0].entry, child);
	assert.equal(roots[0].parentPath, undefined);
	assert.deepEqual(visibleEntryRelations(roots[0]), child.parents);
	parent.metadata.noteTags = ['project', 'doing'];
	const both = nestTaggedEntries(filterProjectEntries([child, parent], ['doing'], status));
	assert.equal(both[0].entry, parent);
	assert.equal(both[0].children[0].entry, child);
	assert.deepEqual(visibleEntryRelations(both[0].children[0]), []);
});

test('metadata status changes remove matches and can leave an empty filtered list without mutation', () => {
	const note = entry('Work', ['project', 'doing']);
	const entries = [note];
	assert.equal(filterProjectEntries(entries, ['doing'], status).length, 1);
	note.metadata.noteTags = ['project', 'completed'];
	assert.deepEqual(filterProjectEntries(entries, ['doing'], status), []);
	assert.deepEqual(entries, [note]);
	assert.deepEqual(note.metadata.noteTags, ['project', 'completed']);
});

test('unknown and malformed saved filters restore All', () => {
	for (const value of [undefined, null, '', 'all', 'DOING', 'project', {}, [], ['unknown']]) {
		assert.equal(normalizeProjectFilter(value), 'all');
	}
	assert.deepEqual(normalizeProjectFilter('doing'), ['doing']);
});

test('multiple statuses match their union without changing order, entries or metadata', () => {
	const entries = [entry('Done', ['project', 'completed']), entry('Work', ['project', 'doing']),
		entry('Wait', ['project', 'waiting']), entry('Plain', ['project'])];
	const before = structuredClone(entries);
	assert.deepEqual(filterProjectEntries(entries, ['doing', 'waiting'], status), [entries[1], entries[2]]);
	assert.deepEqual(entries, before);
});

test('saved selections normalize duplicates and invalid values while migrating legacy strings', () => {
	assert.deepEqual(normalizeProjectFilter(['waiting', 'doing', 'waiting', null, 'unknown']), ['waiting', 'doing']);
	assert.deepEqual(normalizeProjectFilter('waiting'), ['waiting']);
	assert.deepEqual(normalizeProjectFilter(['todo', 'backburner', 'waiting', 'discuss', 'ready', 'doing', 'completed']),
		['todo', 'backburner', 'waiting', 'discuss', 'ready', 'doing', 'completed']);
	assert.equal(projectFilterLabel(['waiting', 'doing']), 'waiting, doing');
});

test('status toggles add and remove selections; clearing the last selection restores All', () => {
	assert.deepEqual(toggleProjectFilter('all', 'doing'), ['doing']);
	assert.deepEqual(toggleProjectFilter(['doing'], 'waiting'), ['waiting', 'doing']);
	assert.deepEqual(toggleProjectFilter(['waiting', 'doing'], 'waiting'), ['doing']);
	assert.equal(toggleProjectFilter(['doing'], 'doing'), 'all');
});


test('pills list only effective statuses assigned to the complete list, in status order', () => {
	const entries = [entry('Work', ['project', 'doing']), entry('Same status', ['project', 'doing']),
		entry('Waiting line', ['project', 'completed'], [[2, '#waiting']], 2), entry('Plain', ['project'])];
	assert.deepEqual(availableProjectStatuses(entries, status).map(item => item.tag), ['todo', 'waiting', 'doing']);
	assert.equal(filterProjectEntries(entries, ['doing'], status).length, 2);
	assert.deepEqual(availableProjectStatuses([], status), []);
});

test('single selection replaces multiple selections, while modified selection toggles them', () => {
	assert.deepEqual(selectProjectFilter(['waiting', 'doing'], 'backburner', false), ['backburner']);
	assert.deepEqual(selectProjectFilter(['doing'], 'waiting', true), ['waiting', 'doing']);
	assert.deepEqual(selectProjectFilter(['waiting', 'doing'], 'waiting', true), ['doing']);
	assert.equal(selectProjectFilter(['doing'], 'doing', false), 'all');
});

test('metadata changes prune unavailable selections and reset an entirely stale filter', () => {
	const available = availableProjectStatuses([entry('Work', ['project', 'doing'])], status);
	assert.equal(reconcileProjectFilter(['waiting', 'doing'], available), 'all');
	assert.equal(reconcileProjectFilter(['waiting'], available), 'all');
	assert.equal(reconcileProjectFilter('all', available), 'all');
});
