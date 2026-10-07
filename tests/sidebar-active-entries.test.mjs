import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const code = buildSync({
	entryPoints: [fileURLToPath(new URL('../src/ui/sidebar-active-entries.ts', import.meta.url))],
	bundle: true, write: false, format: 'esm',
}).outputFiles[0].text;
const { activeSubgoalCount, sidebarGoalGroups, sidebarGoals, sidebarProjects } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const goal = (path, parents = [], dependents = []) => ({
	file: { path, basename: path.replace(/\.md$/, '') }, text: path,
	parents: parents.map(parent => ({ path: parent, name: parent.replace(/\.md$/, ''), icon: 'horizon-goal' })),
	dependents: dependents.map(dependent => ({ path: dependent, name: dependent, icon: 'horizon-goal' })),
});

test('sidebar projects include Discuss, Ready, and Doing only', () => {
	const entries = ['todo', 'backburner', 'waiting', 'discuss', 'ready', 'doing', 'someday', 'completed']
		.map(status => ({ status }));
	assert.deepEqual(sidebarProjects(entries, entry => entry.status).map(entry => entry.status),
		['discuss', 'ready', 'doing']);
});

test('sidebar goals include only rounded progress from 1 through 99 percent', () => {
	const entries = [0, 0.4, 0.5, 25, 99.4, 99.6, 100].map(value => ({ value }));
	const progress = new Map(entries.map(entry => [entry, entry.value]));
	assert.deepEqual(sidebarGoals(entries, progress).map(entry => entry.value), [0.5, 25, 99.4]);
	assert.deepEqual(sidebarGoals([{ value: 25 }], progress), []);
});

test('partial parent goals appear once with their sub-goals nested beneath them', () => {
	const parent = goal('Financial Independence.md');
	const child = goal('Become a freelancer.md', [parent.file.path]);
	const grandchild = goal('Register business.md', [child.file.path]);
	const groups = sidebarGoalGroups([parent, child, grandchild], [grandchild, child, parent]);
	assert.equal(groups.length, 1);
	assert.equal(groups[0].parent, undefined);
	assert.equal(groups[0].entries[0].entry, parent);
	assert.equal(groups[0].entries[0].children[0].entry, child);
	assert.equal(groups[0].entries[0].children[0].children[0].entry, grandchild);
	assert.equal(activeSubgoalCount(groups[0].entries[0].children[0]), 1);
});

test('active subgoal count includes all deeper descendants but excludes the visible first-level goal', () => {
	const root = goal('Root.md');
	const first = goal('First.md', [root.file.path]);
	const second = goal('Second.md', [first.file.path]);
	const third = goal('Third.md', [second.file.path]);
	const sibling = goal('Sibling.md', [first.file.path]);
	const [group] = sidebarGoalGroups([root, first, second, third, sibling], [root, first, second, third, sibling]);
	const node = group.entries[0].children[0];
	assert.equal(activeSubgoalCount(node), 3);
	assert.equal(activeSubgoalCount(node.children[1]), 0);
});

test('a filtered-out goal parent remains a heading, while dependencies do not nest', () => {
	const parent = goal('Parent.md');
	const child = goal('Child.md', [parent.file.path]);
	const dependent = goal('Dependent.md', [], [child.file.path]);
	const groups = sidebarGoalGroups([parent, child, dependent], [child, dependent]);
	assert.equal(groups.length, 2);
	assert.equal(groups[0].parent, undefined);
	assert.equal(groups[0].entries[0].entry, dependent);
	assert.equal(groups[1].parent?.path, parent.file.path);
	assert.equal(groups[1].entries[0].entry, child);
});

test('an Area parent appears as a muted group heading above its goals', () => {
	const first = goal('Financial Independence.md', ['Life.md']);
	const second = goal('Retirement.md', ['Life.md']);
	const child = goal('Become a freelancer.md', [first.file.path]);
	for (const entry of [first, second]) entry.parents[0].icon = 'layers-2';
	const groups = sidebarGoalGroups([first, second, child], [first, second, child]);
	assert.equal(groups.length, 1);
	assert.equal(groups[0].parent?.name, 'Life');
	assert.equal(groups[0].parent?.icon, 'layers-2');
	assert.deepEqual(groups[0].entries.map(node => node.entry), [first, second]);
	assert.equal(groups[0].entries[0].children[0].entry, child);
});

test('goal parent cycles retain each partial goal once', () => {
	const first = goal('First.md', ['Second.md']);
	const second = goal('Second.md', ['First.md']);
	const groups = sidebarGoalGroups([first, second], [first, second]);
	const seen = groups.flatMap(group => {
		const flatten = nodes => nodes.flatMap(node => [node.entry, ...flatten(node.children)]);
		return flatten(group.entries);
	});
	assert.deepEqual(new Set(seen), new Set([first, second]));
});
