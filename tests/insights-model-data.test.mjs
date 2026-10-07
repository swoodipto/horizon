import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

async function moduleAt(relative) {
	const output = await build({ entryPoints: [fileURLToPath(new URL(relative, import.meta.url))], bundle: true, write: false, format: 'esm' });
	return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
}
const { goalSnapshots } = await moduleAt('../src/insights/model.ts');
const { progressLabel } = await moduleAt('../src/insights/types.ts');
const { PluginDataStore } = await moduleAt('../src/plugin-data.ts');
const { observeGoals, historyForGoal } = await moduleAt('../src/insights/history.ts');
const entry = (path, parents = [], line) => ({ file: { path, basename: path }, text: path, parents: parents.map(path => ({ path })), ...(line === undefined ? {} : { line, sourceLine: '- Child #goal' }) });

test('counts direct children equally while keeping weighted progress separate', () => {
	const root = entry('root'); const child = entry('child', ['root']);
	const doing = entry('doing', ['root']); const finished = entry('finished', ['child']);
	const snapshots = goalSnapshots([root, child], [doing, finished], e => e === doing ? 'doing' : 'completed', () => ({ progress: 50, 'start date': '2026-10-01', deadline: '2026-10-10' }));
	assert.deepEqual(snapshots.map(({ scope, started, completed, progress }) => ({ scope, started, completed, progress })), [
		{ scope: 2, started: 1, completed: 1, progress: 75 }, { scope: 1, started: 0, completed: 1, progress: 100 },
	]);
	assert.equal(snapshots[0].start, '2026-10-01');
	assert.equal(snapshots[0].contributors.length, 2);
});

test('one project at 50% is started regardless of its non-completed status', () => {
	const snapshots = goalSnapshots([entry('goal')], [entry('project', ['goal'])], () => 'ready', () => ({ progress: 50 }));
	assert.equal(snapshots[0].progress, 50);
	assert.equal(snapshots[0].scope, 1);
	assert.equal(snapshots[0].started, 1);
	assert.equal(snapshots[0].completed, 0);
});

test('no dependent attribution, double-tagged self counting or flattened descendants', () => {
	const root = entry('goal'); const dependent = { ...entry('dependency'), dependents: [{ path: 'goal' }] };
	const snapshots = goalSnapshots([root, dependent], [root, entry('project', ['dependency'])], () => 'completed', () => ({}));
	assert.equal(snapshots[0].scope, 0);
	assert.equal(snapshots[0].progress, 0);
});

test('inline projects use the source goal and inline goals use source-note dates', () => {
	const root = entry('goal'); const inline = entry('goal', [], 3);
	const snapshots = goalSnapshots([root, inline], [entry('goal', ['other'], 7)], () => 'ready', () => ({ 'start date': '2026-11-01' }));
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
	const snapshot = goalSnapshots([entry('goal')], [entry('project', ['goal'])], () => 'doing', () => ({ progress: 50 }))[0];
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
