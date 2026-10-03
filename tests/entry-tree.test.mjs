import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
const { transformSync } = createRequire(import.meta.url)('esbuild');
const source = fs.readFileSync(new URL('../src/ui/entry-tree.ts', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'esm' }).code;
const { nestTaggedEntries, visibleEntryRelations } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function note(path, parents = []) {
	return { file: { path }, text: path, parents: parents.map(path => ({ path, name: path, icon: 'goal' })) };
}
function flatten(nodes, depth = 0) {
	return nodes.flatMap(node => [{ entry: node.entry, depth }, ...flatten(node.children, depth + 1)]);
}

function dependentNote(path, dependents, parents = []) {
	return { ...note(path, parents), dependents: dependents.map(path => ({ path, name: path, icon: 'goal' })) };
}

test('dependent chains nest once with their own relationship type and hide the displayed reference', () => {
	const a = dependentNote('A.md', ['B.md']);
	const b = dependentNote('B.md', ['C.md']);
	const c = note('C.md');
	const roots = nestTaggedEntries([a, b, c]);
	assert.deepEqual(flatten(roots).map(row => [row.entry.file.path, row.depth]), [['C.md', 0], ['B.md', 1], ['A.md', 2]]);
	assert.equal(roots[0].children[0].relationship, 'dependent');
	assert.equal(roots[0].children[0].children[0].relationship, 'dependent');
	assert.deepEqual(visibleEntryRelations(roots[0].children[0]), []);
});

test('available parents take precedence; dependent references remain when they are not the nesting edge', () => {
	const parent = note('Parent.md');
	const dependency = note('Dependency.md');
	const child = dependentNote('Child.md', ['Dependency.md'], ['Parent.md']);
	const roots = nestTaggedEntries([child, parent, dependency]);
	assert.equal(roots[0].children[0].relationship, 'parent');
	assert.deepEqual(visibleEntryRelations(roots[0].children[0]), child.dependents);
	const fallback = nestTaggedEntries([child, dependency]);
	assert.equal(fallback[0].children[0].relationship, 'dependent');
	assert.deepEqual(visibleEntryRelations(fallback[0].children[0]), child.parents);
});

test('dependents outside the list and unresolved links stay visible without false nesting', () => {
	const root = note('A/Work.md');
	const child = dependentNote('Child.md', ['B/Work.md']);
	child.dependents.push({ name: 'Work', icon: 'sticky-note' });
	const roots = nestTaggedEntries([root, child]);
	assert.equal(roots.length, 2);
	assert.deepEqual(visibleEntryRelations(roots[1]), child.dependents);
});

test('mixed parent/dependent cycles and self references retain every entry once', () => {
	const a = dependentNote('A.md', ['A.md', 'B.md']);
	const b = note('B.md', ['A.md']);
	const rows = flatten(nestTaggedEntries([a, b]));
	assert.equal(rows.length, 2);
	assert.equal(new Set(rows.map(row => row.entry)).size, 2);
});

test('same linked note in both properties is deduplicated, and inline rows retain parent semantics', () => {
	const source = dependentNote('Source.md', ['Other.md'], ['Other.md']);
	assert.equal(visibleEntryRelations(nestTaggedEntries([source])[0]).length, 1);
	const line = { file: source.file, text: 'Inline', subtitle: 'Source', line: 3 };
	const roots = nestTaggedEntries([line, source]);
	assert.equal(roots[0].children[0].relationship, 'parent');
	assert.deepEqual(visibleEntryRelations(roots[0].children[0]), []);
	assert.equal(roots[0].children[0].entry.line, 3);
});

test('nested note hides only its nesting parent and retains outside parent references', () => {
	const parent = note('Goals/Work.md');
	const child = note('Design.md', ['Areas/Work.md', 'Goals/Work.md']);
	child.parents[0].name = child.parents[1].name = 'Work';
	const tree = nestTaggedEntries([child, parent]);
	assert.deepEqual(visibleEntryRelations(tree[0].children[0]), [child.parents[0]]);
	assert.deepEqual(child.parents.map(parent => parent.path), ['Areas/Work.md', 'Goals/Work.md']);
});

test('a nested inline entry hides the source-note subtitle without losing navigation data', () => {
	const parent = note('Finance.md');
	const line = { file: parent.file, text: 'invest', subtitle: 'Finance', line: 7 };
	const tree = nestTaggedEntries([line, parent]);
	const child = tree[0].children[0];
	assert.deepEqual(visibleEntryRelations(child), []);
	assert.equal(child.entry.line, 7);
	assert.deepEqual(visibleEntryRelations(nestTaggedEntries([line])[0]), [
		{ name: 'Finance', icon: 'sticky-note', path: 'Finance.md' },
	]);
});

test('a child with no remaining parents renders no subtitle; root parent mentions remain', () => {
	const parent = note('Parent.md');
	const child = note('Child.md', ['Parent.md']);
	assert.deepEqual(visibleEntryRelations(nestTaggedEntries([parent, child])[0].children[0]), []);
	assert.deepEqual(visibleEntryRelations(nestTaggedEntries([child])[0]), child.parents);
	const unresolved = note('Other.md');
	unresolved.parents = [{ name: 'Outside', icon: 'sticky-note' }];
	assert.deepEqual(visibleEntryRelations(nestTaggedEntries([unresolved])[0]), unresolved.parents);
});

test('moves an alphabetically earlier child under its listed parent through multiple levels', () => {
	const child = note('Design as Art.md', ['Freelance Ready.md', 'Apartment Cover Letter.md']);
	const area = note('Freelance Ready.md');
	const grandchild = note('Animation.md', ['Design as Art.md']);
	const other = note('Apartment Cover Letter.md');
	assert.deepEqual(flatten(nestTaggedEntries([grandchild, other, child, area])), [
		{ entry: other, depth: 0 }, { entry: area, depth: 0 },
		{ entry: child, depth: 1 }, { entry: grandchild, depth: 2 },
	]);
});

test('a parent outside the category is skipped; each child occurs once under the first listed parent', () => {
	const a = note('A.md');
	const b = note('B.md');
	const child = note('C.md', ['Outside.md', 'B.md', 'A.md']);
	assert.deepEqual(flatten(nestTaggedEntries([a, b, child])), [
		{ entry: a, depth: 0 }, { entry: b, depth: 0 }, { entry: child, depth: 1 },
	]);
});

test('inline content nests under its source note and retains exact line navigation data', () => {
	const parent = note('Finance.md');
	const line = { file: parent.file, text: 'invest', subtitle: 'Finance', line: 7 };
	const missing = { file: { path: 'Other.md' }, text: 'save', line: 4 };
	assert.deepEqual(flatten(nestTaggedEntries([line, parent, missing])), [
		{ entry: parent, depth: 0 }, { entry: line, depth: 1 }, { entry: missing, depth: 0 },
	]);
});

test('matching uses resolved paths rather than duplicate names or unresolved subtitles', () => {
	const parent = note('Areas/Work.md');
	const child = note('Child.md', ['Goals/Work.md']);
	const unresolved = note('Unresolved.md');
	unresolved.parents = [{ name: 'Work', icon: 'goal' }];
	assert.deepEqual(flatten(nestTaggedEntries([parent, child, unresolved])).map(row => row.depth), [0, 0, 0]);
});

test('cycles and self references keep all entries visible exactly once', () => {
	const a = note('A.md', ['A.md', 'B.md']);
	const b = note('B.md', ['C.md']);
	const c = note('C.md', ['A.md']);
	const rows = flatten(nestTaggedEntries([a, b, c]));
	assert.equal(rows.length, 3);
	assert.equal(new Set(rows.map(row => row.entry)).size, 3);
	assert.deepEqual(rows.map(row => row.entry.file.path), ['C.md', 'B.md', 'A.md']);
});

test('root and sibling order remain stable and source entries are unchanged', () => {
	const parent = note('Z.md');
	const a = note('A.md', ['Z.md']);
	const b = note('B.md', ['Z.md']);
	const entries = [a, b, parent];
	const before = structuredClone(entries);
	assert.deepEqual(flatten(nestTaggedEntries(entries)).map(row => row.entry.file.path), ['Z.md', 'A.md', 'B.md']);
	assert.deepEqual(entries, before);
	assert.deepEqual(nestTaggedEntries([]), []);
});
