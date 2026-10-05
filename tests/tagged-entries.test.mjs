import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { buildSync, transformSync } = createRequire(import.meta.url)('esbuild');
const source = fs.readFileSync(new URL('../src/ui/tagged-notes.ts', import.meta.url), 'utf8');
const compiled = buildSync({ stdin: { contents: source, loader: 'ts', resolveDir: fileURLToPath(new URL('../src/ui/', import.meta.url)) }, bundle: true, write: false, format: 'esm' }).outputFiles[0].text;
const { findTaggedEntries, iconForNoteTags } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const treeSource = fs.readFileSync(new URL('../src/ui/entry-tree.ts', import.meta.url), 'utf8');
const treeCode = transformSync(treeSource, { loader: 'ts', format: 'esm' }).code;
const { nestTaggedEntries, visibleEntryRelations } = await import(`data:text/javascript;base64,${Buffer.from(treeCode).toString('base64')}`);

function inline(content, line, tag) {
	const col = content.split(/\r?\n/)[line].indexOf(tag);
	assert.ok(col >= 0);
	return { tag, position: { start: { line, col }, end: { line, col: col + tag.length } } };
}
function note(basename, content, noteTags = [], taggedLines = []) {
	return { basename, path: `${basename}.md`, content, metadata: {
		noteTags, lineTags: taggedLines.map(([line, tag]) => inline(content, line, tag)),
	} };
}
const metadata = file => file.metadata;
const read = async file => file.content;

test('all categories carry dependent note links into nesting and leave inline source relationships intact', async () => {
	for (const tag of ['#area', '#goal', '#project']) {
		const linked = note('Linked', '', [tag]);
		const child = note('Child', `- work ${tag}`, [tag], [[0, tag]]);
		child.metadata.dependents = [{ name: linked.basename, path: linked.path, icon: iconForNoteTags([tag]) }];
		const entries = await findTaggedEntries([child, linked], metadata, read, tag);
		const roots = nestTaggedEntries(entries);
		assert.equal(roots.length, 1);
		assert.equal(roots[0].entry.file, linked);
		const nested = roots[0].children[0];
		assert.equal(nested.relationship, 'dependent');
		assert.deepEqual(visibleEntryRelations(nested), []);
		assert.equal(nested.children[0].relationship, 'parent');
		assert.equal(nested.children[0].entry.line, 0);
		assert.deepEqual(visibleEntryRelations(nested.children[0]), []);
		assert.equal(nestTaggedEntries(entries.filter(entry => entry.file !== linked))[0].entry.subtitle, 'Linked');
	}
});

test('property-tagged notes display their parent relation using the subtitle', async () => {
	for (const tag of ['#area', '#goal', '#project']) {
		const file = note('finance', 'anything', [tag]);
		file.metadata.parents = [{name: 'Freelance', icon: 'layers-2'}];
		assert.deepEqual(await findTaggedEntries([file], metadata, read, tag), [
			{ file, text: 'finance', subtitle: 'Freelance', parents: file.metadata.parents },
		]);
	}
});

test('a note parent relation does not replace the parent note subtitle on inline entries', async () => {
	const file = note('finance', '- invest #goal', ['#goal'], [[0, '#goal']]);
	file.metadata.parents = [{name: 'Freelance', icon: 'layers-2'}, {name: 'Work', icon: 'goal'}];
	assert.deepEqual(await findTaggedEntries([file], metadata, read, '#goal'), [
		{ file, text: 'finance', subtitle: 'Freelance, Work', parents: file.metadata.parents },
		{ file, text: 'invest', subtitle: 'finance', line: 0 },
	]);
});

test('inline goal lists the line text and parent note, without a whole-note entry', async () => {
	const file = note('finance', '- make investments #goal\n- research dividends', [], [[0, '#goal']]);
	const result = await findTaggedEntries([file], metadata, read, '#goal');
	assert.deepEqual(result, [{ file, text: 'make investments', subtitle: 'finance', line: 0 }]);
});

test('property tags list the note once without reading its content', async () => {
	const file = note('finance', 'anything', ['#goal', '#goal/long-term']);
	const result = await findTaggedEntries([file], metadata, async () => assert.fail('Unnecessary content read'), '#goal');
	assert.deepEqual(result, [{ file, text: 'finance' }]);
});

test('a property entry coexists with distinct tagged lines; repeated matching tags on a line deduplicate', async () => {
	const file = note('finance', '- invest #goal #goal/2026\n- invest #goal', ['#goal'], [[0, '#goal'], [0, '#goal/2026'], [1, '#goal']]);
	const result = await findTaggedEntries([file], metadata, read, '#goal');
	assert.deepEqual(result.map(({ text, line }) => ({ text, line })), [
		{ text: 'finance', line: undefined },
		{ text: 'invest', line: 0 },
		{ text: 'invest', line: 1 },
	]);
});

test('all categories accept nested and uppercase tags but exclude similar prefixes', async () => {
	const file = note('Plan', 'Health #AREA\nSave #GOAL/2026\nNo #goals\nBuild #PROJECT/work\nNo #projects', [], [[0, '#AREA'], [1, '#GOAL/2026'], [2, '#goals'], [3, '#PROJECT/work'], [4, '#projects']]);
	for (const [tag, text, line] of [['#area', 'Health', 0], ['#goal', 'Save', 1], ['#project', 'Build', 3]]) {
		assert.deepEqual(await findTaggedEntries([file], metadata, read, tag), [{ file, text, subtitle: 'Plan', line, ...(tag === '#project' ? {sourceLine: 'Build #PROJECT/work'} : {}) }]);
	}
});

test('labels omit bullets, tasks, headings and the category tag; preserve other tags and Unicode', async () => {
	const file = note('finance', '- [ ] 💰 make investments #goal #urgent\r\n> 1. [x] Save #goal\r\n## Research #goal', [], [[0, '#goal'], [1, '#goal'], [2, '#goal']]);
	const result = await findTaggedEntries([file], metadata, read, '#goal');
	assert.deepEqual(result.map(entry => entry.text).sort(), ['💰 make investments #urgent', 'Save', 'Research'].sort());
	assert.deepEqual(result.map(entry => entry.line).sort(), [0, 1, 2]);
});

test('uncached code tags and untagged notes are not scanned; only matching inline files are read', async () => {
	const code = note('Code', '```\n- fake #goal\n```');
	const missing = { basename: 'Missing', path: 'Missing.md', metadata: null };
	const unrelated = note('Area', 'Home #area', [], [[0, '#area']]);
	const match = note('finance', 'Save #goal', [], [[0, '#goal']]);
	const reads = [];
	const result = await findTaggedEntries([code, missing, unrelated, match], metadata, async file => { reads.push(file.path); return file.content; }, '#goal');
	assert.deepEqual(reads, ['finance.md']);
	assert.equal(result.length, 1);
});

test('updated cached positions follow inserted lines and renamed notes', async () => {
	const file = note('finance', 'Intro\n- invest #goal', [], [[1, '#goal']]);
	assert.equal((await findTaggedEntries([file], metadata, read, '#goal'))[0].line, 1);
	const updated = note('finances', 'New intro\nIntro\n- invest #goal', [], [[2, '#goal']]);
	assert.deepEqual(await findTaggedEntries([updated], metadata, read, '#goal'), [{ file: updated, text: 'invest', subtitle: 'finances', line: 2 }]);
});


test('parent note icons follow property tags, including nested and uppercase tags', () => {
 for (const [tags, icon] of [
  [['#area'], 'layers-2'], [['#AREA/work'], 'layers-2'],
  [['#goal'], 'horizon-goal'], [['#goal/2026'], 'horizon-goal'],
  [['#project'], 'circle-small'], [['#PROJECT/work'], 'circle-small'],
  [['#project', '#ready'], 'circle'], [['#project', '#doing'], 'circle-chevron-right'],
  [['#project', '#completed'], 'circle-check-big'], [['#project', '#backburner'], 'circle-stop'], [['#project', '#someday'], 'circle-dashed'],
  [[], 'sticky-note'], [['#areas', '#goals', '#projects', '#other'], 'sticky-note'],
 ]) assert.equal(iconForNoteTags(tags), icon);
});

test('project notes and inline content share nesting and omit only the displayed parent', async () => {
	const parent = note('Website', '', ['#project']);
	const child = note('Design', '- create mockups #project', ['#project'], [[0, '#project']]);
	child.metadata.parents = [
		{ name: 'Freelance', icon: 'layers-2', path: 'Freelance.md' },
		{ name: parent.basename, icon: iconForNoteTags(parent.metadata.noteTags), path: parent.path },
	];
	const entries = await findTaggedEntries([child, parent], metadata, read, '#project');
	const tree = nestTaggedEntries(entries);
	assert.equal(tree.length, 1);
	assert.equal(tree[0].entry.file, parent);
	const project = tree[0].children[0];
	assert.equal(project.entry.file, child);
	assert.deepEqual(visibleEntryRelations(project), [child.metadata.parents[0]]);
	const line = project.children[0];
	assert.equal(line.entry.text, 'create mockups');
	assert.equal(line.entry.line, 0);
	assert.deepEqual(visibleEntryRelations(line), []);
});
