import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({
	entryPoints: [fileURLToPath(new URL('../src/insights/history.ts', import.meta.url))],
	bundle: true, write: false, format: 'esm', target: 'es2021',
});
const { emptyHistory, normalizeHistory, observeGoals, historyForGoal, renameHistory } =
	await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

const HOUR = 3_600_000;
const at = (day = 7, hour = 12, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const whole = (path = 'Goal.md') => ({ path });
const inline = (path = 'Notes.md', line = 2, sourceLine = '- Goal #goal') => ({ path, line, sourceLine });
const child = (path = 'Work.md', state = 'unstarted') => ({ identity: whole(path), state });
const lineChild = (line = 2, sourceLine = '- Work #project', state = 'unstarted') =>
	({ identity: inline('Work.md', line, sourceLine), state });
function snapshot(identity = whole(), contributors = [], progress) {
	const started = contributors.filter(item => item.state === 'started').length;
	const completed = contributors.filter(item => item.state === 'completed').length;
	return {
		identity, contributors, scope: contributors.length, started, completed,
		unstarted: contributors.length - started - completed,
		progress: progress ?? (contributors.length ? 100 * (completed + started / 2) / contributors.length : 0),
		entry: { file: { path: identity.path, secret: 'do not retain file content' }, text: 'private display title',
			parents: [{ path: 'Private.md', name: 'private relationship title' }], sourceLine: identity.sourceLine },
		start: '2026-10-01', deadline: '2026-10-31', unrelated: 'discard me',
	};
}
const goal = (history, identity = whole()) => {
	const result = historyForGoal(history, identity);
	assert.ok(result);
	return result;
};
const observe = (history, contributors, time = at(), continuous = true, identity = whole(), progress) =>
	observeGoals(history, [snapshot(identity, contributors, progress)], time, continuous);
const roundtrip = history => normalizeHistory(JSON.parse(JSON.stringify(history)));

test('starts with a versioned serializable empty history and captures zero and completed goals', () => {
	const history = emptyHistory();
	assert.deepEqual(history, { version: 1, goals: [], nextId: 1 });
	assert.equal(observeGoals(history, [snapshot(), snapshot(whole('Done.md'), [child('Done work.md', 'completed')])], at(), false), true);
	assert.equal(history.goals.length, 2);
	assert.deepEqual(goal(history).points, [{ at: at(), date: '2026-10-07', scope: 0, started: 0, completed: 0, progress: 0 }]);
	assert.equal(goal(history).firstObserved, at());
	assert.equal(goal(history).lastObserved, at());
	assert.equal(goal(history, whole('Done.md')).completions.length, 0);
	assert.deepEqual(roundtrip(history), history);
});

test('first observation is one actual point, never a reconstructed zero origin', () => {
	const history = emptyHistory();
	observe(history, [child('A.md', 'completed'), child('B.md', 'started')], at(), false);
	assert.equal(goal(history).points.length, 1);
	assert.equal(goal(history).points[0].progress, 75);
	assert.equal(goal(history).points[0].completed, 1);
	assert.equal(goal(history).points[0].started, 1);
	assert.equal(goal(history).completions.length, 0);
});

test('compacts unchanged observations but advances lastObserved and emits hourly checkpoints', () => {
	const history = emptyHistory();
	observe(history, [child()]);
	assert.equal(observe(history, [child()], at() + HOUR - 1), false);
	assert.equal(goal(history).lastObserved, at() + HOUR - 1);
	assert.equal(history.lastObserved, at() + HOUR - 1);
	assert.equal(goal(history).points.length, 1);
	assert.equal(observe(history, [child()], at() + HOUR), true);
	assert.equal(goal(history).points.length, 2);
	assert.equal(observe(history, [child()], at() + HOUR), false);
	assert.deepEqual(roundtrip(history), history);
});

test('JSON reload preserves a heartbeat-only lastObserved without fabricating or moving checkpoints', () => {
	const history = emptyHistory();
	observe(history, [child()]);
	assert.equal(observe(history, [child()], at() + HOUR - 1), false);
	const restored = roundtrip(history);
	assert.deepEqual(restored, history);
	assert.equal(restored.goals[0].firstObserved, at());
	assert.equal(restored.goals[0].lastObserved, at() + HOUR - 1);
	assert.equal(restored.lastObserved, at() + HOUR - 1);
	assert.equal(restored.goals[0].points.at(-1).at, at());
	const unchanged = JSON.stringify(restored);
	assert.equal(observe(restored, [child('Work.md', 'completed')], at() + HOUR - 2), false);
	assert.equal(JSON.stringify(restored), unchanged);
	assert.equal(observe(restored, [child('Work.md', 'completed')], at() + HOUR, false), true);
	assert.equal(goal(restored).points.at(-1).gap, true);
	assert.equal(goal(restored).completions.length, 0);
	assert.deepEqual(roundtrip(restored), restored);
});

test('multiple heartbeat-only reloads still use the original checkpoint for the hourly deadline', () => {
	let history = emptyHistory();
	observe(history, [child()]);
	for (const minute of [10, 20, 30, 59]) {
		assert.equal(observe(history, [child()], at() + minute * 60_000), false);
		history = roundtrip(history);
		assert.equal(goal(history).points.length, 1);
		assert.equal(goal(history).lastObserved, at() + minute * 60_000);
	}
	assert.equal(observe(history, [child()], at() + HOUR), true);
	assert.equal(goal(history).points.length, 2);
});

test('records changed fractional percentages and counts immediately without rounding', () => {
	const history = emptyHistory();
	observe(history, [child()], at(), true, whole(), 0);
	assert.equal(observe(history, [child('Work.md', 'started')], at() + 1, true, whole(), 0.125), true);
	assert.equal(goal(history).points[1].progress, 0.125);
	assert.equal(goal(history).points[1].started, 1);
	assert.equal(observe(history, [child('Work.md', 'started')], at() + 2, true, whole(), 0.25), true);
	assert.equal(goal(history).points[2].progress, 0.25);
});

test('an observed same-child completion contributes one event with a seven-day bucket', () => {
	const history = emptyHistory();
	observe(history, [child()]);
	observe(history, [child('Work.md', 'started')], at() + 1);
	observe(history, [child('Work.md', 'completed')], at() + 2);
	const stored = goal(history);
	assert.deepEqual(stored.completions, [{ at: at() + 2, date: '2026-10-07', bucket: '2026-10-07', contributorId: stored.contributors[0].id }]);
	assert.deepEqual(roundtrip(history), history);
});

test('reopening lowers completed work; recompletion counts once per child per bucket', () => {
	const history = emptyHistory();
	observe(history, [child()]);
	observe(history, [child('Work.md', 'completed')], at(8));
	observe(history, [child('Work.md', 'started')], at(9));
	assert.equal(goal(history).points.at(-1).completed, 0);
	observe(history, [child('Work.md', 'completed')], at(10));
	assert.equal(goal(history).completions.length, 1);
	observe(history, [child()], at(13));
	observe(history, [child('Work.md', 'completed')], at(14));
	assert.deepEqual(goal(history).completions.map(event => event.bucket), ['2026-10-07', '2026-10-14']);
	assert.deepEqual(roundtrip(history), history);
});

test('buckets are seven civil days from first observation, not rolling milliseconds or weekday boundaries', () => {
	const history = emptyHistory();
	observe(history, [child()], at(23, 23));
	observe(history, [child('Work.md', 'completed')], at(24, 0));
	observe(history, [child()], at(29, 23));
	observe(history, [child('Work.md', 'completed')], at(30, 0));
	assert.deepEqual(goal(history).completions.map(event => event.bucket), ['2026-10-23', '2026-10-30']);
});

test('different children can complete in the same bucket; reordering does not swap identities', () => {
	const history = emptyHistory();
	observe(history, [child('A.md'), child('B.md')]);
	observe(history, [child('B.md', 'completed'), child('A.md', 'completed')], at() + 1);
	assert.equal(goal(history).completions.length, 2);
	assert.equal(new Set(goal(history).completions.map(event => event.contributorId)).size, 2);
	assert.equal(observe(history, [child('A.md', 'completed'), child('B.md', 'completed')], at() + 2), false);
});

test('new already-completed children and removal change scope, never create completion events', () => {
	const history = emptyHistory();
	observe(history, [child()]);
	observe(history, [child(), child('New.md', 'completed')], at() + 1);
	assert.equal(goal(history).points.at(-1).scope, 2);
	assert.equal(goal(history).points.at(-1).completed, 1);
	assert.equal(goal(history).completions.length, 0);
	observe(history, [child()], at() + 2);
	assert.equal(goal(history).points.at(-1).scope, 1);
	assert.equal(goal(history).points.at(-1).completed, 0);
	assert.equal(goal(history).completions.length, 0);
});

test('retagged/removed children reset the transition baseline on reappearance', () => {
	const history = emptyHistory();
	observe(history, [child()]);
	observe(history, [], at() + 1);
	observe(history, [child('Work.md', 'completed')], at() + 2);
	assert.equal(goal(history).completions.length, 0);
	observe(history, [child()], at() + 3);
	observe(history, [child('Work.md', 'completed')], at() + 4);
	assert.equal(goal(history).completions.length, 1);
	observe(history, [], at() + 5);
	observe(history, [child()], at() + 6);
	observe(history, [child('Work.md', 'completed')], at() + 7);
	assert.equal(goal(history).completions.length, 1);
});

test('reparenting completion into another goal does not borrow the old goal baseline', () => {
	const history = emptyHistory();
	observeGoals(history, [snapshot(whole('A.md'), [child()]), snapshot(whole('B.md'))], at(), true);
	observeGoals(history, [snapshot(whole('A.md')), snapshot(whole('B.md'), [child('Work.md', 'completed')])], at() + 1, true);
	assert.equal(goal(history, whole('A.md')).completions.length, 0);
	assert.equal(goal(history, whole('B.md')).completions.length, 0);
	observeGoals(history, [snapshot(whole('A.md'), [child('Work.md', 'completed')]), snapshot(whole('B.md'))], at() + 2, true);
	assert.equal(goal(history, whole('A.md')).completions.length, 0);
});

test('membership changes do not suppress a retained identifiable child completion', () => {
	const history = emptyHistory();
	observe(history, [child('Stay.md'), child('Remove.md')]);
	observe(history, [child('Stay.md', 'completed'), child('New.md', 'completed')], at() + 1);
	assert.equal(goal(history).completions.length, 1);
	assert.equal(goal(history).completions[0].contributorId, goal(history).contributors.find(item => item.identity.path === 'Stay.md').id);
});

test('an unavailable interval marks a gap and resets all transition baselines without backfill', () => {
	const history = emptyHistory();
	observe(history, [child()]);
	assert.equal(observe(history, [child('Work.md', 'completed')], at(28), false), true);
	assert.equal(goal(history).points.length, 2);
	assert.equal(goal(history).points[1].gap, true);
	assert.equal(goal(history).completions.length, 0);
	observe(history, [child()], at(28) + 1);
	observe(history, [child('Work.md', 'completed')], at(28) + 2);
	assert.equal(goal(history).completions.length, 1);
});

test('unchanged state after sleep still records a gap; new goals after sleep have no synthetic gap', () => {
	const history = emptyHistory();
	observe(history, [child()]);
	observeGoals(history, [snapshot(whole(), [child()]), snapshot(whole('New.md'))], at() + 1, false);
	assert.equal(goal(history).points.at(-1).gap, true);
	assert.equal(goal(history, whole('New.md')).points[0].gap, undefined);
	assert.equal(observe(history, [child()], at() + 2), true); // New goal disappears.
	assert.equal(observe(history, [child()], at() + 3), false);
});

test('missing goals are archived without invented points; reactivation is a gap and not completion', () => {
	const history = emptyHistory();
	observe(history, [child()]);
	const stored = goal(history);
	assert.equal(observeGoals(history, [], at() + 1, true), true);
	assert.equal(stored.active, false);
	assert.equal(stored.lastObserved, at());
	assert.equal(stored.points.length, 1);
	assert.deepEqual(roundtrip(history), history);
	assert.equal(observeGoals(history, [], at() + 2, true), false);
	observe(history, [child('Work.md', 'completed')], at() + 3);
	assert.equal(goal(history), stored);
	assert.equal(stored.points.at(-1).gap, true);
	assert.equal(stored.completions.length, 0);
});

test('progress dropping to zero retains history and follows later changes', () => {
	const history = emptyHistory();
	observe(history, [child('Work.md', 'started')]);
	observe(history, [child()], at() + 1);
	const stored = goal(history);
	assert.equal(stored.active, true);
	assert.equal(stored.points.at(-1).progress, 0);
	observe(history, [child('Work.md', 'completed')], at() + 2);
	assert.equal(goal(history), stored);
	assert.equal(stored.completions.length, 1);
});

test('whole-note rename preserves observations and child identity/bucket dedup', () => {
	const history = emptyHistory();
	observe(history, [child()]);
	observe(history, [child('Work.md', 'completed')], at() + 1);
	const stored = goal(history);
	renameHistory(history, 'Goal.md', 'Renamed goal.md');
	renameHistory(history, 'Work.md', 'Renamed work.md');
	assert.equal(historyForGoal(history, whole()), undefined);
	assert.equal(goal(history, whole('Renamed goal.md')), stored);
	assert.equal(stored.contributors[0].identity.path, 'Renamed work.md');
	observe(history, [child('Renamed work.md')], at() + 2, true, whole('Renamed goal.md'));
	observe(history, [child('Renamed work.md', 'completed')], at() + 3, true, whole('Renamed goal.md'));
	assert.equal(stored.completions.length, 1);
	assert.deepEqual(roundtrip(history), history);
});

test('rename covers inline goals, inline children and inactive dedup identities', () => {
	const history = emptyHistory();
	observe(history, [lineChild()], at(), true, inline());
	observe(history, [lineChild(2, '- Work #project', 'completed')], at() + 1, true, inline());
	observe(history, [], at() + 2, true, inline());
	renameHistory(history, 'Notes.md', 'Moved/Notes.md');
	renameHistory(history, 'Work.md', 'Moved/Work.md');
	const stored = goal(history, inline('Moved/Notes.md'));
	assert.deepEqual(stored.contributors[0].identity, inline('Moved/Work.md', 2, '- Work #project'));
	assert.equal(stored.contributors[0].present, false);
	assert.equal(stored.completions.length, 1);
	assert.deepEqual(roundtrip(history), history);
});

test('uniquely moved inline goal preserves its exact source identity and all history', () => {
	const history = emptyHistory();
	observe(history, [child()], at(), true, inline());
	const stored = goal(history, inline());
	observe(history, [child('Work.md', 'completed')], at() + 1, true, inline('Notes.md', 9));
	assert.equal(goal(history, inline('Notes.md', 9)), stored);
	assert.equal(stored.identity.line, 9);
	assert.equal(stored.firstObserved, at());
	assert.equal(stored.completions.length, 1);
	assert.equal(history.goals.length, 1);
});

test('uniquely moved inline child preserves baseline and bucket dedup', () => {
	const history = emptyHistory();
	observe(history, [lineChild()]);
	observe(history, [lineChild(8, '- Work #project', 'completed')], at() + 1);
	assert.equal(goal(history).completions.length, 1);
	const id = goal(history).contributors[0].id;
	observe(history, [lineChild(12)], at() + 2);
	observe(history, [lineChild(15, '- Work #project', 'completed')], at() + 3);
	assert.equal(goal(history).contributors[0].id, id);
	assert.equal(goal(history).contributors[0].identity.line, 15);
	assert.equal(goal(history).completions.length, 1);
});

test('edited inline goal begins a new baseline, never inherits history at the same index', () => {
	const history = emptyHistory();
	observe(history, [child()], at(), true, inline());
	const previous = goal(history, inline());
	const edited = inline('Notes.md', 2, '- Changed goal #goal');
	observe(history, [child('Work.md', 'completed')], at() + 1, true, edited);
	const stored = goal(history, edited);
	assert.notEqual(stored, previous);
	assert.equal(stored.firstObserved, at() + 1);
	assert.equal(stored.points.length, 1);
	assert.equal(stored.completions.length, 0);
	assert.equal(previous.active, false);
});

test('edited inline child resets its baseline, including edits to status tags', () => {
	const history = emptyHistory();
	observe(history, [lineChild(2, '- Work #project #doing', 'started')]);
	observe(history, [lineChild(2, '- Work #project #completed', 'completed')], at() + 1);
	assert.equal(goal(history).completions.length, 0);
	assert.equal(goal(history).contributors.filter(item => item.present).length, 1);
	assert.deepEqual(roundtrip(history), history);
});

test('incoming duplicate inline goals cannot borrow a unique original even at its old line', () => {
	const history = emptyHistory();
	observe(history, [child()], at(), true, inline());
	const original = goal(history, inline());
	observeGoals(history, [snapshot(inline(), [child('Work.md', 'completed')]),
		snapshot(inline('Notes.md', 8), [child('Other.md', 'completed')])], at() + 1, true);
	assert.equal(original.active, false);
	for (const key of [inline(), inline('Notes.md', 8)]) {
		const current = goal(history, key);
		assert.notEqual(current.id, original.id);
		assert.equal(current.firstObserved, at() + 1);
		assert.equal(current.completions.length, 0);
	}
	assert.equal(historyForGoal(history, inline('Notes.md', 999)), undefined);
	const length = history.goals.length;
	assert.equal(observeGoals(history, [snapshot(inline(), [child('Work.md', 'completed')]),
		snapshot(inline('Notes.md', 8), [child('Other.md', 'completed')])], at() + 2, true), false);
	assert.equal(history.goals.length, length);
	assert.deepEqual(roundtrip(history), history);
});

test('exact duplicate goal identities fail closed without repeatedly growing or borrowing history', () => {
	const history = emptyHistory();
	observe(history, [child()], at(), true, inline());
	const original = goal(history, inline());
	const duplicate = [snapshot(inline(), [child('Work.md', 'completed')]), snapshot(inline(), [child('Other.md', 'completed')])];
	assert.equal(observeGoals(history, duplicate, at() + 1, true), true);
	assert.equal(original.active, false);
	assert.equal(original.retired, true);
	assert.equal(historyForGoal(history, inline()), undefined);
	const length = history.goals.length;
	assert.equal(observeGoals(history, duplicate, at() + 2, true), false);
	assert.equal(history.goals.length, length);
	assert.deepEqual(roundtrip(history), history);
	observe(history, [child('Work.md', 'completed')], at() + 3, true, inline());
	assert.notEqual(goal(history, inline()), original);
	assert.equal(goal(history, inline()).firstObserved, at() + 3);
	assert.equal(goal(history, inline()).completions.length, 0);
});

test('exact duplicate child identities cannot count a transition or become a borrowed baseline', () => {
	const history = emptyHistory();
	observe(history, [lineChild()]);
	const stored = goal(history);
	observe(history, [lineChild(2, '- Work #project', 'completed'), lineChild(2, '- Work #project', 'completed')], at() + 1);
	assert.equal(stored.active, false);
	assert.equal(stored.completions.length, 0);
	assert.deepEqual(roundtrip(history), history);
	observe(history, [lineChild(2, '- Work #project', 'completed')], at() + 2);
	assert.equal(goal(history).points.at(-1).gap, true);
	assert.equal(goal(history).completions.length, 0);
});

test('incoming duplicate inline contributors cannot borrow a unique original baseline', () => {
	const history = emptyHistory();
	observe(history, [lineChild()]);
	const originalId = goal(history).contributors[0].id;
	observe(history, [lineChild(2, '- Work #project', 'completed'), lineChild(8, '- Work #project', 'completed')], at() + 1);
	assert.equal(goal(history).completions.length, 0);
	assert.ok(goal(history).contributors.filter(item => item.present).every(item => item.id !== originalId));
	assert.equal(observe(history, [lineChild(2, '- Work #project', 'completed'), lineChild(8, '- Work #project', 'completed')], at() + 2), false);
});

test('moving ambiguous duplicate lines or returning to uniqueness starts new baselines', () => {
	const history = emptyHistory();
	observe(history, [lineChild(2), lineChild(8)]);
	observe(history, [lineChild(3, '- Work #project', 'completed'), lineChild(9, '- Work #project', 'completed')], at() + 1);
	assert.equal(goal(history).completions.length, 0);
	observe(history, [lineChild(3)], at() + 2);
	observe(history, [lineChild(3, '- Work #project', 'completed')], at() + 3);
	assert.equal(goal(history).completions.length, 1);
	assert.deepEqual(roundtrip(history), history);
});

test('swapped states between stationary identical inline lines cannot manufacture completion', () => {
	const history = emptyHistory();
	observe(history, [lineChild(2), lineChild(8, '- Work #project', 'completed')]);
	observe(history, [lineChild(2, '- Work #project', 'completed'), lineChild(8)], at() + 1);
	assert.equal(goal(history).completions.length, 0);
	assert.equal(goal(history).points.length, 2);
});

test('unique inline reactivation preserves history but resets the transition baseline with a gap', () => {
	const history = emptyHistory();
	observe(history, [child()], at(), true, inline());
	const stored = goal(history, inline());
	observeGoals(history, [], at() + 1, true);
	observe(history, [child('Work.md', 'completed')], at() + 2, true, inline());
	assert.equal(goal(history, inline()), stored);
	assert.equal(stored.firstObserved, at());
	assert.equal(stored.points.at(-1).gap, true);
	assert.equal(goal(history, inline()).completions.length, 0);
});

test('unique inline child reappearance preserves bucket dedup but cannot count its unseen completion', () => {
	const history = emptyHistory();
	observe(history, [lineChild()]);
	observe(history, [lineChild(2, '- Work #project', 'completed')], at() + 1);
	observe(history, [], at() + 2);
	observe(history, [lineChild(8)], at() + 3);
	observe(history, [lineChild(8, '- Work #project', 'completed')], at() + 4);
	assert.equal(goal(history).completions.length, 1);
	assert.equal(goal(history).contributors.length, 1);
	assert.deepEqual(roundtrip(history), history);
});

test('reverting an edited inline goal cannot resurrect its retired source-line baseline', () => {
	const history = emptyHistory();
	observe(history, [child()], at(), true, inline());
	const original = goal(history, inline());
	observe(history, [child()], at() + 1, true, inline('Notes.md', 2, '- Changed #goal'));
	observe(history, [child('Work.md', 'completed')], at() + 2, true, inline());
	assert.notEqual(goal(history, inline()), original);
	assert.equal(goal(history, inline()).firstObserved, at() + 2);
	assert.equal(goal(history, inline()).completions.length, 0);
	assert.deepEqual(roundtrip(history), history);
});

test('incoming duplicate inline children in different goals cannot borrow either prior baseline', () => {
	const history = emptyHistory();
	observeGoals(history, [snapshot(whole('A.md'), [lineChild()]), snapshot(whole('B.md'))], at(), true);
	observeGoals(history, [snapshot(whole('A.md'), [lineChild(2, '- Work #project', 'completed')]),
		snapshot(whole('B.md'), [lineChild(8, '- Work #project', 'completed')])], at() + 1, true);
	assert.equal(goal(history, whole('A.md')).completions.length, 0);
	assert.equal(goal(history, whole('B.md')).completions.length, 0);
	assert.equal(observeGoals(history, [snapshot(whole('A.md'), [lineChild(2, '- Work #project', 'completed')]),
		snapshot(whole('B.md'), [lineChild(8, '- Work #project', 'completed')])], at() + 2, true), false);
	assert.deepEqual(roundtrip(history), history);
});

test('a sub-goal represented as a contributor and its own snapshot is not a duplicated physical line', () => {
	const history = emptyHistory();
	const subgoal = inline();
	observeGoals(history, [snapshot(whole(), [{ identity: subgoal, state: 'unstarted' }]), snapshot(subgoal, [child()])], at(), true);
	observeGoals(history, [snapshot(whole(), [{ identity: subgoal, state: 'completed' }]), snapshot(subgoal, [child('Work.md', 'completed')])], at() + 1, true);
	assert.equal(goal(history).completions.length, 1);
	assert.equal(goal(history, subgoal).completions.length, 1);
});

test('retired ambiguous children cannot block later unique bucket dedup after another disappearance', () => {
	const history = emptyHistory();
	observe(history, [lineChild(2), lineChild(8)]);
	observe(history, [lineChild(2)], at() + 1);
	observe(history, [lineChild(2, '- Work #project', 'completed')], at() + 2);
	observe(history, [], at() + 3);
	observe(history, [lineChild(5)], at() + 4);
	observe(history, [lineChild(5, '- Work #project', 'completed')], at() + 5);
	assert.equal(goal(history).completions.length, 1);
	assert.deepEqual(roundtrip(history), history);
});

test('recorded data excludes titles, source files and dates used by forecasts', () => {
	const history = emptyHistory();
	const value = snapshot({ path: 'Goal.md', sourceLine: 'not required for a whole-note identity' }, [child()]);
	observeGoals(history, [value], at(), true);
	const json = JSON.stringify(history);
	for (const text of ['private display title', 'private relationship title', 'do not retain file content', 'not required', 'discard me', '2026-10-01', '2026-10-31']) {
		assert.equal(json.includes(text), false);
	}
	assert.deepEqual(goal(history).identity, whole());
	assert.deepEqual(roundtrip(history), history);
});

test('copies incoming identity objects, so caller mutation cannot rewrite old history', () => {
	const history = emptyHistory();
	const value = snapshot(inline(), [lineChild()]);
	observeGoals(history, [value], at(), true);
	value.identity.path = 'Mutated.md';
	value.contributors[0].identity.sourceLine = '- Changed source';
	assert.equal(goal(history, inline()).identity.path, 'Notes.md');
	assert.equal(goal(history, inline()).contributors[0].identity.sourceLine, '- Work #project');
});

test('JSON restoration can continue transitions; reload continuity false suppresses closed-app work', () => {
	let history = emptyHistory();
	observe(history, [child()]);
	history = roundtrip(history);
	observe(history, [child('Work.md', 'completed')], at() + 1, false);
	assert.equal(goal(history).completions.length, 0);
	assert.equal(goal(history).points.at(-1).gap, true);
	history = roundtrip(history);
	observe(history, [child()], at() + 2);
	observe(history, [child('Work.md', 'completed')], at() + 3);
	assert.equal(goal(history).completions.length, 1);
	assert.deepEqual(roundtrip(history), history);
});

test('no arbitrary short retention drops old checkpoints or completion dedup records', () => {
	const history = emptyHistory();
	observe(history, [child()]);
	observe(history, [child('Work.md', 'completed')], at() + 1);
	const later = new Date(2031, 9, 7, 12).getTime();
	observe(history, [child('Work.md', 'completed')], later, false);
	assert.equal(goal(history).firstObserved, at());
	assert.equal(goal(history).points.length, 3);
	assert.equal(goal(history).completions.length, 1);
	assert.equal(goal(history).points.at(-1).gap, true);
	assert.deepEqual(roundtrip(history), history);
});

test('normalization rejects unknown versions, missing roots and non-object input safely', () => {
	for (const value of [undefined, null, 1, 'history', [], {}, { version: 2, goals: [] }, { version: 1, goals: null }]) {
		assert.deepEqual(normalizeHistory(value), emptyHistory());
	}
});

test('normalization strips unsupported fields, detaches values and repairs unsafe ID counters', () => {
	const history = emptyHistory();
	observe(history, [child()]);
	const raw = JSON.parse(JSON.stringify(history));
	raw.nextId = Infinity;
	raw.title = 'private title';
	raw.goals[0].entry = { text: 'private title' };
	raw.goals[0].identity.text = 'private title';
	raw.goals[0].points[0].note = 'full note';
	const normalized = normalizeHistory(raw);
	assert.deepEqual(normalized, history);
	assert.notEqual(normalized.goals[0], raw.goals[0]);
	raw.goals[0].identity.path = 'Mutated.md';
	assert.equal(goal(normalized).identity.path, 'Goal.md');
});

test('invalid numeric, date, identity, ledger and chronological data cannot become a baseline', () => {
	const source = emptyHistory();
	observe(source, [child()]);
	const edits = [
		g => { g.points[0].progress = NaN; },
		g => { g.points[0].progress = 101; },
		g => { g.points[0].progress = -1; },
		g => { g.points[0].scope = Infinity; },
		g => { g.points[0].scope = -1; },
		g => { g.points[0].scope = 1.5; },
		g => { g.points[0].started = 2; },
		g => { g.points[0].completed = 2; },
		g => { g.points[0].at = NaN; },
		g => { g.points[0].at = Number.MAX_SAFE_INTEGER; },
		g => { g.points[0].date = '2026-02-30'; },
		g => { g.points[0].gap = 'yes'; },
		g => { g.firstObserved++; },
		g => { g.lastObserved = at() - 1; },
		g => { g.points.push({ ...g.points[0], at: at() - 1 }); },
		g => { g.identity.path = ''; },
		g => { g.identity.line = 1; },
		g => { g.identity.line = -1; g.identity.sourceLine = '- Goal #goal'; },
		g => { g.identity.line = 1; g.identity.sourceLine = 'line\nfull note'; },
		g => { g.contributors[0].state = 'unknown'; },
		g => { g.contributors[0].id = g.id; },
		g => { g.contributors[0].present = false; },
		g => { g.active = 'yes'; },
	];
	for (const edit of edits) {
		const raw = structuredClone(source);
		edit(raw.goals[0]);
		const normalized = normalizeHistory(raw);
		assert.equal(normalized.goals.length, 0);
		observe(normalized, [child('Work.md', 'completed')], at() + 1);
		assert.equal(goal(normalized).completions.length, 0);
	}
});

test('valid goals survive alongside corrupt records and duplicated persistent IDs are rejected', () => {
	const history = emptyHistory();
	observeGoals(history, [snapshot(whole('Good.md')), snapshot(whole('Bad.md'))], at(), true);
	const raw = structuredClone(history);
	raw.goals[1].points[0].scope = -1;
	assert.equal(normalizeHistory(raw).goals.length, 1);
	const duplicate = structuredClone(history);
	duplicate.goals[1].id = duplicate.goals[0].id;
	assert.equal(normalizeHistory(duplicate).goals.length, 1);
});

test('normalization validates completion identities/times/buckets and removes duplicate bucket events', () => {
	const history = emptyHistory();
	observe(history, [child()]);
	observe(history, [child('Work.md', 'completed')], at() + 1);
	const duplicate = structuredClone(history);
	duplicate.goals[0].completions.push({ ...duplicate.goals[0].completions[0] });
	assert.deepEqual(normalizeHistory(duplicate), history);
	for (const edit of [
		e => { e.at = Infinity; }, e => { e.at = at() - 1; },
		e => { e.contributorId = 999; }, e => { e.bucket = '2026-10-08'; },
		e => { e.date = '2026-02-30'; },
	]) {
		const raw = structuredClone(history);
		edit(raw.goals[0].completions[0]);
		assert.equal(normalizeHistory(raw).goals.length, 0);
	}
});

test('normalization tolerates supported civil boundary dates without throwing on malformed bucket data', () => {
	const history = emptyHistory();
	observe(history, [child()]);
	observe(history, [child('Work.md', 'completed')], at() + 1);
	const raw = structuredClone(history);
	raw.goals[0].points[0].date = '0001-01-02';
	raw.goals[0].completions[0].date = '0001-01-01';
	raw.goals[0].completions[0].bucket = '0001-01-02';
	assert.doesNotThrow(() => normalizeHistory(raw));
	assert.equal(normalizeHistory(raw).goals.length, 1);
});

test('invalid/stale observation timestamps are ignored without mutation or invented transitions', () => {
	const history = emptyHistory();
	observe(history, [child()]);
	for (const time of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, at() - 1, at() + 0.5]) {
		const before = JSON.stringify(history);
		assert.equal(observe(history, [child('Work.md', 'completed')], time), false);
		assert.equal(JSON.stringify(history), before);
	}
});

test('unsupported ID bounds stop observation safely', () => {
	const history = emptyHistory();
	history.nextId = Number.MAX_SAFE_INTEGER - 1;
	const before = JSON.stringify(history);
	assert.equal(observe(history, [child()]), false);
	assert.equal(JSON.stringify(history), before);
});

test('rename only changes exact validated paths, and conflicting goals never borrow a baseline', () => {
	const history = emptyHistory();
	observeGoals(history, [snapshot(whole('Goal.md'), [child()]), snapshot(whole('Folder/Goal.md'))], at(), true);
	renameHistory(history, 'Goal.md', 'Renamed.md');
	assert.ok(historyForGoal(history, whole('Folder/Goal.md')));
	const before = JSON.stringify(history);
	renameHistory(history, 'Renamed.md', '');
	renameHistory(history, 'Renamed.md', 'Renamed.md');
	assert.equal(JSON.stringify(history), before);
	renameHistory(history, 'Renamed.md', 'Folder/Goal.md');
	assert.equal(historyForGoal(history, whole('Folder/Goal.md')), undefined);
	observe(history, [child('Work.md', 'completed')], at() + 1, true, whole('Folder/Goal.md'));
	assert.equal(goal(history, whole('Folder/Goal.md')).completions.length, 0);
});
