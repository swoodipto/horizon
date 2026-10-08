import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { taskCache } from './task-fixtures.mjs';

async function moduleAt(relative) {
	const output = await build({ entryPoints: [fileURLToPath(new URL(relative, import.meta.url))], bundle: true, write: false, format: 'esm' });
	return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
}
const { goalSnapshots, projectPaceSnapshots } = await moduleAt('../src/insights/model.ts');
const { progressLabel, visiblePaceEntry } = await moduleAt('../src/insights/types.ts');
const { PluginDataStore } = await moduleAt('../src/plugin-data.ts');
const { observeGoals, historyForGoal } = await moduleAt('../src/insights/history.ts');
const entry = (path, parents = [], line) => ({ file: { path, basename: path }, text: path, parents: parents.map(path => ({ path })), ...(line === undefined ? {} : { line, sourceLine: '- Child #goal' }) });

test('Insights hides goals without valid start dates, but not their linked project cards', () => {
	for (const start of [undefined, '', 'invalid', '2026-02-30']) assert.equal(visiblePaceEntry({ kind: 'goal', progress: 40, start }), false);
	assert.equal(visiblePaceEntry({ kind: 'goal', progress: 40, start: '2026-10-04' }), true);
	assert.equal(visiblePaceEntry({ kind: 'goal', progress: 100, start: new Date('2026-10-04T00:00:00Z') }), true);
	assert.equal(visiblePaceEntry({ kind: 'goal', progress: 0, start: '2026-10-04' }), false);
	for (const start of [undefined, '', 'invalid', '2026-02-30']) assert.equal(visiblePaceEntry({ kind: 'project', progress: 40, start }), false);
	for (const progress of [0, 0.25, 40, 100]) assert.equal(visiblePaceEntry({ kind: 'project', progress, start: '2026-10-04' }), true);
	assert.equal(visiblePaceEntry({ kind: 'project', progress: 0, start: new Date('2026-10-04T00:00:00Z') }), true);
});

test('zero-progress projects appear from their own start date with or without parents and retain optional deadlines', () => {
	const goal = entry('goal'), linked = entry('linked', ['goal']), loose = entry('loose');
	for (const deadline of [undefined, '2026-10-18']) {
		const properties = file => file.path === 'goal' ? {} : { 'start date': '2026-10-04', deadline };
		const tasks = () => taskCache(0, 2);
		const goals = goalSnapshots([goal], [linked, loose], () => 'todo', properties, tasks);
		const cards = projectPaceSnapshots(goals, [linked, loose], () => 'todo', properties, tasks).filter(visiblePaceEntry);
		assert.equal(visiblePaceEntry({ ...goals[0], kind: 'goal' }), false);
		assert.deepEqual(cards.map(item => item.identity.path), ['linked', 'loose']);
		for (const card of cards) {
			assert.equal(card.progress, 0);
			assert.equal(card.start, '2026-10-04');
			assert.equal(card.deadline, deadline);
		}
	}
});

test('standalone projects appear even when there are no goals, using only their own valid start dates', () => {
	const projects = [entry('dated'), entry('undated'), entry('invalid')];
	for (const deadline of [undefined, '2026-10-18']) {
		const properties = file => file.path === 'dated' ? { 'start date': '2026-10-04', deadline }
			: file.path === 'invalid' ? { 'start date': '2026-02-30' } : {};
		const cards = projectPaceSnapshots([], projects, () => 'todo', properties, () => []).filter(visiblePaceEntry);
		assert.deepEqual(cards.map(item => item.identity.path), ['dated']);
		assert.equal(cards[0].progress, 0); assert.equal(cards[0].deadline, deadline);
	}
});

test('pace cards include whole-note projects regardless of relationships, with their own schedule and no dual-tag duplicates', () => {
	const goal = entry('goal'), subgoal = entry('subgoal', ['goal']);
	const linked = entry('linked', ['subgoal']), loose = entry('loose');
	const dependent = { ...entry('dependent'), dependents: [{ path: 'goal' }] };
	const inline = entry('goal', [], 2);
	const projects = [linked, loose, dependent, inline, goal];
	const properties = file => ({ progress: 40, ...(file.path === 'linked' ? { 'start date': '2026-10-04', deadline: '2026-10-18' }
		: file.path === 'subgoal' ? { 'start date': '2026-10-04', deadline: '2026-12-31' } : {}) });
	const tasks = () => taskCache(2, 5);
	const goals = goalSnapshots([goal, subgoal], projects, () => 'doing', properties, tasks);
	const cards = projectPaceSnapshots(goals, projects, () => 'doing', properties, tasks);
	assert.deepEqual(cards.map(item => item.identity.path), ['linked', 'loose', 'dependent']);
	assert.deepEqual(cards.filter(visiblePaceEntry).map(item => item.identity.path), ['linked']);
	assert.equal(cards[0].progress, 40); assert.equal(cards[0].deadline, '2026-10-18');
	assert.equal(goals[1].deadline, '2026-12-31'); assert.equal(goals[0].start, undefined);
});

test('counts direct children equally while keeping weighted progress separate', () => {
	const root = entry('root'); const child = entry('child', ['root']);
	const doing = entry('doing', ['root']); const finished = entry('finished', ['child']);
	const snapshots = goalSnapshots([root, child], [doing, finished], e => e === doing ? 'doing' : 'completed', () => ({ progress: 99, 'start date': '2026-10-01', deadline: '2026-10-10' }), () => taskCache(1, 2));
	assert.deepEqual(snapshots.map(({ scope, started, completed, progress }) => ({ scope, started, completed, progress })), [
		{ scope: 2, started: 1, completed: 1, progress: 75 }, { scope: 1, started: 0, completed: 1, progress: 100 },
	]);
	assert.equal(snapshots[0].start, '2026-10-01');
	assert.equal(snapshots[0].contributors.length, 2);
});

test('one project at 50% is started regardless of its non-completed status', () => {
	const snapshots = goalSnapshots([entry('goal')], [entry('project', ['goal'])], () => 'ready', () => ({ progress: 99 }), () => taskCache(1, 2));
	assert.equal(snapshots[0].progress, 50);
	assert.equal(snapshots[0].scope, 1);
	assert.equal(snapshots[0].started, 1);
	assert.equal(snapshots[0].completed, 0);
});

test('no dependent attribution, double-tagged self counting or flattened descendants', () => {
	const root = entry('goal'); const dependent = { ...entry('dependency'), dependents: [{ path: 'goal' }] };
	const snapshots = goalSnapshots([root, dependent], [root, entry('project', ['dependency'])], () => 'completed', () => ({}), () => []);
	assert.equal(snapshots[0].scope, 0);
	assert.equal(snapshots[0].progress, 0);
});

test('inline projects use the source goal and inline goals use source-note dates', () => {
	const root = entry('goal'); const inline = entry('goal', [], 3);
	const tasks = () => [{ ...taskCache(0, 1, { start: 7 })[0], task: undefined }, ...taskCache(1, 4, { start: 8, parent: 7, col: 2 })];
	const snapshots = goalSnapshots([root, inline], [entry('goal', ['other'], 7)], () => 'ready', () => ({ 'start date': '2026-11-01' }), tasks);
	assert.equal(snapshots[0].scope, 2);
	assert.equal(snapshots[0].progress, 12.5);
	assert.equal(snapshots[1].start, '2026-11-01');
	assert.equal(snapshots[1].identity.sourceLine, '- Child #goal');
});

test('literal eligibility can include tiny unrounded progress and 100%', () => {
	assert.equal(progressLabel(0.25), '<1%');
	assert.equal(progressLabel(100), '100%');
	assert.equal(progressLabel(50.1), '50%');
});

test('flat preferences survive migration and malformed history is safely empty', async () => {
	let saved;
	const store = new PluginDataStore({ useThemeContentWidth: false, customContentWidth: 1200, insights: { version: 999 } }, async data => { saved = data; });
	assert.deepEqual(store.settings, { useThemeContentWidth: false, customContentWidth: 1200 });
	assert.equal(store.history.goals.length, 0);
	await store.save();
	assert.equal(saved.customContentWidth, 1200);
	assert.equal(saved.insights.version, 1);
});

test('observed history survives JSON reload and a subsequent preference save', async () => {
	let saved;
	const store = new PluginDataStore({}, async data => { saved = data; });
	const snapshot = goalSnapshots([entry('goal')], [entry('project', ['goal'])], () => 'doing', () => ({ progress: 99 }), () => taskCache(1, 2))[0];
	observeGoals(store.history, [snapshot], new Date(2026, 9, 7, 12).getTime(), false);
	await store.save({ useThemeContentWidth: false, customContentWidth: 999 });
	const restored = new PluginDataStore(saved, async data => { saved = data; });
	assert.equal(historyForGoal(restored.history, snapshot.identity).points[0].progress, 50);
	await restored.save({ useThemeContentWidth: true, customContentWidth: 760 });
	assert.equal(saved.insights.goals[0].points[0].scope, 1);
});

test('all writes are serialized and snapshot the latest preferences/history', async () => {
	const saved = []; let release;
	const blocker = new Promise(resolve => { release = resolve; });
	let concurrent = 0; let maximum = 0;
	const store = new PluginDataStore({}, async data => {
		maximum = Math.max(maximum, ++concurrent);
		if (saved.length === 0) await blocker;
		saved.push(data); concurrent--;
	});
	const first = store.save();
	await new Promise(resolve => setImmediate(resolve));
	const second = store.save({ useThemeContentWidth: false, customContentWidth: 1600 });
	store.history.nextId = 19;
	release(); await Promise.all([first, second]);
	assert.equal(maximum, 1);
	assert.equal(saved[1].customContentWidth, 1600);
	assert.equal(saved[1].insights.nextId, 19);
});

test('failed persistence rejects honestly, and a later save can recover', async () => {
	let calls = 0;
	const store = new PluginDataStore({}, async () => { if (++calls === 1) throw new Error('write failed'); });
	await assert.rejects(store.save(), /write failed/);
	await store.save(); assert.equal(calls, 2);
});
