import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { buildSync } = createRequire(import.meta.url)('esbuild');
const code = buildSync({
	stdin: { contents: "export * from './goal-progress';", loader: 'ts',
		resolveDir: fileURLToPath(new URL('../src/ui/', import.meta.url)) },
	bundle: true, write: false, format: 'esm',
}).outputFiles[0].text;
const { goalProgress, projectProgress } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const relation = path => ({ path, name: path, icon: 'horizon-goal' });
const goal = (path, parents = [], line) => ({
	file: { path }, text: path, parents: parents.map(relation), line,
});
const project = (path, status, parents = [], line, dependents = []) => ({
	file: { path }, text: path, parents: parents.map(relation),
	dependents: dependents.map(relation), line, status,
});
const measure = (goals, projects) => goalProgress(goals, projects, entry => entry.status, entry => entry.progress);

test('projects use measured task percentages, default to zero and complete at 100', () => {
	for (const status of ['todo', 'backburner', 'waiting', 'someday', 'discuss', 'ready', 'doing']) {
		assert.equal(projectProgress(status, undefined), 0);
		assert.equal(projectProgress(status, 42.5), 42.5);
	}
	for (const invalid of [-1, 101, Number.NaN, Infinity, '40%', '40']) {
		assert.equal(projectProgress('doing', invalid), 0);
	}
	assert.equal(projectProgress('completed', 85), 100);
	assert.equal(projectProgress('completed', undefined), 100);
	// Inline and whole-note projects use the same measurement, never status-based partial credit.
	assert.equal(projectProgress('ready', 70), 70);
	assert.equal(projectProgress('doing', 70), 70);
});

test('sub-goals average their projects and roll up to the parent goal', () => {
	const root = goal('Financial Independence.md');
	const freelancer = goal('Become officially a freelancer.md', [root.file.path]);
	const creator = goal('Become content creator.md', [root.file.path]);
	const registration = project('Freelance registration.md', 'ready', [freelancer.file.path]);
	const followers = project('Get 1000 followers.md', 'completed', [creator.file.path]);
	registration.progress = 25;
	let progress = measure([root, freelancer, creator], [registration, followers]);
	assert.equal(progress.get(freelancer), 25);
	assert.equal(progress.get(creator), 100);
	assert.equal(progress.get(root), 62.5);
	registration.status = 'doing';
	registration.progress = 50;
	progress = measure([root, freelancer, creator], [registration, followers]);
	assert.equal(progress.get(root), 75);
	registration.status = 'completed';
	progress = measure([root, freelancer, creator], [registration, followers]);
	assert.equal(progress.get(root), 100);
});

test('a single project percentage reaches both its sub-goal and parent goal', () => {
	const root = goal('Understand my resources.md');
	const child = goal('Build Productivity Tool with Insights.md', [root.file.path]);
	const horizon = project('horizon for Obsidian.md', 'doing', [child.file.path]);
	horizon.progress = 40;
	let progress = measure([root, child], [horizon]);
	assert.equal(progress.get(child), 40);
	assert.equal(progress.get(root), 40);
	horizon.progress = 85;
	progress = measure([root, child], [horizon]);
	assert.equal(progress.get(child), 85);
	assert.equal(progress.get(root), 85);
});

test('direct projects and sub-goals have equal shares without counting descendants twice', () => {
	const root = goal('Goal.md');
	const child = goal('Sub-goal.md', [root.file.path]);
	const direct = project('Direct.md', 'completed', [root.file.path]);
	const nested = project('Nested.md', 'doing', [child.file.path]);
	nested.progress = 50;
	const progress = measure([root, child], [direct, nested]);
	assert.equal(progress.get(child), 50);
	assert.equal(progress.get(root), 75);
});

test('only parent relationships count, with one owning goal per project', () => {
	const first = goal('First.md');
	const second = goal('Second.md');
	const linked = project('Linked.md', 'completed', ['Outside.md', first.file.path, second.file.path]);
	const dependency = project('Dependency.md', 'completed', [], undefined, [second.file.path]);
	const unrelated = project('Unrelated.md', 'completed');
	const progress = measure([first, second], [linked, dependency, unrelated]);
	assert.equal(progress.get(first), 100);
	assert.equal(progress.get(second), 0);
});

test('inline projects belong to their source goal, but a dual-tagged entry cannot count itself', () => {
	const root = goal('Source.md');
	const inline = project('Source.md', 'completed', [], 4);
	const dualTag = project('Source.md', 'completed');
	const progress = measure([root], [inline, dualTag]);
	assert.equal(progress.get(root), 100);
	assert.equal(measure([root], [dualTag]).get(root), 0);
});

test('dependency nesting and untracked leaf goals do not imply completion', () => {
	const root = goal('Root.md');
	const dependent = { ...goal('Dependent.md'), dependents: [relation(root.file.path)] };
	const child = goal('Child.md', [root.file.path]);
	const done = project('Done.md', 'completed', [dependent.file.path]);
	const progress = measure([root, dependent, child], [done]);
	assert.equal(progress.get(root), 0);
	assert.equal(progress.get(dependent), 100);
	assert.equal(progress.get(child), 0);
});
