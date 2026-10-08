import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

async function moduleAt(relative, mock = false) {
	const output = await build({ entryPoints: [fileURLToPath(new URL(relative, import.meta.url))], bundle: true, write: false, format: 'esm', plugins: mock ? [{
		name: 'obsidian', setup(builder) {
			builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'mock', namespace: 'test' }));
			builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export class Notice {}', loader: 'js' }));
		},
	}] : [] });
	return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
}
const { InsightsService } = await moduleAt('../src/insights/service.ts', true);
const { PluginDataStore } = await moduleAt('../src/plugin-data.ts');
const { renameHistory, emptyHistory, observeGoals } = await moduleAt('../src/insights/history.ts');
const snapshot = state => ({ identity: { path: 'Folder/Goal.md' }, entry: {}, scope: 1, progress: state === 'completed' ? 100 : state === 'started' ? 50 : 0,
	started: Number(state === 'started'), completed: Number(state === 'completed'), unstarted: Number(state === 'unstarted'),
	contributors: [{ identity: { path: 'Folder/Project.md' }, state }] });
const idle = () => new Promise(resolve => setImmediate(resolve));

function fixture(t) {
	t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 7, 12).getTime() });
	const timeouts = new Map(); const intervals = new Map(); const events = new Map(); const cleanups = []; const saved = [];
	let id = 0; let refreshes = 0;
	globalThis.window = {
		setTimeout(fn) { timeouts.set(++id, fn); return id; }, clearTimeout(id) { timeouts.delete(id); },
		setInterval(fn) { intervals.set(++id, fn); return id; }, clearInterval(id) { intervals.delete(id); },
	};
	globalThis.document = { hidden: false };
	t.after(() => { delete globalThis.window; delete globalThis.document; });
	const data = new PluginDataStore({ useThemeContentWidth: false, customContentWidth: 999 }, async value => { saved.push(value); });
	const service = new InsightsService(data);
	const plugin = {
		app: { vault: { on(name, fn) { events.set(name, fn); return fn; } } },
		register(fn) { cleanups.push(fn); }, registerEvent() {},
		registerDomEvent(_el, name, fn) { events.set(name, fn); cleanups.push(() => events.delete(name)); },
		registerInterval(id) { cleanups.push(() => window.clearInterval(id)); },
	};
	service.start(plugin, () => { refreshes++; service.accept([snapshot('started')]); });
	return { data, service, saved, events, intervals, timeouts,
		advance(ms) { t.mock.timers.setTime(Date.now() + ms); },
		tick() { for (const fn of intervals.values()) fn(); },
		flush() { const callbacks = [...timeouts.values()]; timeouts.clear(); callbacks.forEach(fn => fn()); },
		refreshes: () => refreshes, dispose() { cleanups.forEach(fn => fn()); },
	};
}
test('observations publish while the view is closed, debounce saves and retain preferences', async t => {
	const f = fixture(t); let renders = 0; const unsubscribe = f.service.subscribe(() => renders++);
	f.service.accept([snapshot('unstarted')]); f.advance(1000); f.service.accept([snapshot('started')]);
	assert.equal(f.service.ready, true); assert.equal(renders, 2); assert.equal(f.timeouts.size, 1);
	f.flush(); await idle(); assert.equal(f.saved.length, 1); assert.equal(f.saved[0].customContentWidth, 999);
	assert.equal(f.saved[0].insights.goals[0].points.length, 2);
	unsubscribe(); f.advance(1000); f.service.accept([snapshot('completed')]);
	assert.equal(renders, 2); assert.equal(f.service.history(snapshot('completed')).completions.length, 1);
	f.dispose(); await idle(); assert.equal(f.intervals.size, 0); assert.equal(f.timeouts.size, 0);
	assert.equal(f.saved.at(-1).insights.goals[0].points.at(-1).completed, 1);
	f.service.accept([snapshot('started')]); assert.equal(f.service.goals[0].completed, 1);
});

test('linked project snapshots publish while closed without adding project percentage history', t => {
	const f = fixture(t), project = { kind: 'project', identity: { path: 'Project.md' }, entry: {}, progress: 40,
		start: '2026-10-04', deadline: '2026-10-18' };
	let renders = 0; f.service.subscribe(() => renders++);
	f.service.accept([snapshot('started')], [project]);
	assert.equal(f.service.projects[0].progress, 40);
	f.advance(1000); f.service.accept([snapshot('started')], [{ ...project, progress: 85 }]);
	assert.equal(f.service.projects[0].progress, 85); assert.equal(renders, 2);
	assert.deepEqual(f.data.history.goals.map(goal => goal.identity.path), ['Folder/Goal.md']);
	f.dispose(); f.service.accept([], []); assert.equal(f.service.projects[0].progress, 85);
});
test('hourly and local-midnight checkpoints request fresh evaluation, not invented backfills', t => {
	const f = fixture(t); f.service.accept([snapshot('started')]);
	for (let minute = 1; minute <= 60; minute++) { f.advance(60_000); f.tick(); }
	assert.equal(f.refreshes(), 1); assert.equal(f.data.history.goals[0].points.length, 2);
	assert.equal(f.data.history.goals[0].points[1].gap, undefined);
	// Walk to midnight without a sleep gap; day rollover requests evaluation before an hour elapses.
	t.mock.timers.setTime(new Date(2026, 9, 7, 23, 59, 30).getTime()); f.tick();
	const before = f.refreshes(); f.advance(60_000); f.tick(); assert.equal(f.refreshes(), before + 1);
	assert.equal(f.data.history.goals[0].points.at(-1).date, '2026-10-08');
});
test('sleep and visibility gaps cannot count an unknown completion', t => {
	const f = fixture(t); f.service.accept([snapshot('started')]);
	f.advance(3_600_000); f.service.accept([snapshot('completed')]);
	assert.equal(f.data.history.goals[0].points.at(-1).gap, true);
	assert.equal(f.data.history.goals[0].completions.length, 0);
	document.hidden = true; f.events.get('visibilitychange')(); f.tick();
	const before = f.refreshes(); document.hidden = false; f.events.get('visibilitychange')();
	assert.equal(f.refreshes(), before + 1); assert.equal(f.data.history.goals[0].points.at(-1).gap, true);
	f.advance(1000); f.service.accept([snapshot('completed')]);
	assert.equal(f.data.history.goals[0].completions.length, 1);
});
test('folder rename moves goal and contributor identities without matching sibling prefixes', () => {
	const history = emptyHistory(); const first = snapshot('started'); const sibling = snapshot('started');
	sibling.identity = { path: 'Folderish/Goal.md' }; sibling.contributors[0].identity = { path: 'Folderish/Project.md' };
	observeGoals(history, [first, sibling], new Date(2026, 9, 7, 12).getTime(), false);
	renameHistory(history, 'Folder', 'Moved');
	assert.equal(history.goals[0].identity.path, 'Moved/Goal.md');
	assert.equal(history.goals[0].contributors[0].identity.path, 'Moved/Project.md');
	assert.equal(history.goals[1].identity.path, 'Folderish/Goal.md');
});
