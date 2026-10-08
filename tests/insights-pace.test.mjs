import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/insights/pace.ts', import.meta.url))], bundle: true, write: false, format: 'esm' });
const { percentagePace, paceLayout, percentage, paceRate } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const input = (progress = 40, extra = {}) => ({ progress, start: '2026-10-04', deadline: '2026-10-18', ...extra });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} vs ${expected}`);

test('scope examples use elapsed intervals, never inclusive item capacity or past observations', () => {
	const first = percentagePace(input(), '2026-10-07');
	close(first.requiredToday, 100 * 3 / 14); close(first.requiredAverage, 100 / 14);
	close(first.actualAverage, 40 / 3); close(first.remainingRequired, 60 / 11); close(first.delta, 40 - 100 * 3 / 14);
	assert.equal(first.message, 'Ahead of required pace');
	const second = percentagePace(input(85), '2026-10-10');
	close(second.requiredToday, 100 * 6 / 14); close(second.actualAverage, 85 / 6); close(second.remainingRequired, 15 / 8);
	assert.equal(percentage(second.requiredToday), '42.86%');
	const graph = paceLayout(second);
	assert.equal((graph.actualPath.match(/L/g) ?? []).length, 1);
	assert.equal((graph.requiredPath.match(/L/g) ?? []).length, 1);
	assert.equal(second.finish, undefined);
});

test('before and on start: current point only, no backward line or divide-by-zero', () => {
	for (const date of ['2026-10-01', '2026-10-04']) {
		const pace = percentagePace(input(), date);
		assert.equal(pace.requiredToday, 0); assert.equal(pace.actualAverage, undefined);
		assert.equal(paceLayout(pace).actualPath, ''); assert.ok(paceLayout(pace).requiredPath);
	}
});

test('deadline and overdue states keep required targets while estimating unfinished work', () => {
	for (const date of ['2026-10-18', '2026-11-01']) {
		const pace = percentagePace(input(), date);
		assert.equal(pace.requiredToday, 100); assert.equal(pace.remainingRequired, undefined);
		assert.equal(pace.overdue, date > '2026-10-18');
		assert.ok(pace.estimatedEnd > date); assert.ok(paceLayout(pace).estimatePath);
		assert.ok(paceLayout(pace).requiredPath);
	}
	const completed = percentagePace(input(100), '2026-11-01');
	assert.equal(completed.message, 'Completed'); assert.equal(completed.overdue, false); assert.equal(completed.remainingRequired, undefined);
	assert.equal(completed.estimatedEnd, undefined); assert.equal(paceLayout(completed).estimatePath, '');
});

test('dated entries estimate before, on or after the deadline without altering required pace', () => {
	for (const [progress, finish] of [[40, '2026-10-12'], [37.5, '2026-10-12'], [10, '2026-11-03']]) {
		const source = input(progress, { deadline: '2026-10-12' }), original = { ...source };
		const pace = percentagePace(source, '2026-10-07'), layout = paceLayout(pace);
		assert.equal(pace.estimatedEnd, finish); assert.equal(pace.deadline, source.deadline);
		assert.deepEqual(source, original);
		close(pace.requiredToday, 37.5); close(pace.requiredAverage, 12.5);
		assert.equal(layout.requiredPath, `M ${layout.x(pace.start)} ${layout.y(0)} L ${layout.x(pace.deadline)} ${layout.y(100)}`);
		assert.ok(layout.estimatePath);
		close((layout.y(0) - layout.current.y) / (layout.current.x - layout.x(pace.start)),
			(layout.current.y - layout.y(100)) / (layout.estimateX - layout.current.x));
		assert.equal(layout.to, finish > pace.deadline ? finish : pace.deadline);
	}
});

test('missing, invalid and reversed schedules keep actual percentage without required geometry', () => {
	for (const [extra, message] of [
		[{ start: undefined }, 'Add a start date'],
		[{ start: '2026-02-30' }, 'Fix dates'], [{ deadline: 'bad' }, 'Fix dates'],
		[{ deadline: '2026-10-03' }, 'Fix dates'],
	]) {
		const pace = percentagePace(input(40, extra), '2026-10-07');
		assert.equal(pace.progress, 40); assert.equal(pace.message, message); assert.equal(pace.requiredToday, undefined);
		assert.equal(paceLayout(pace).requiredPath, ''); assert.equal(paceLayout(pace).actualPath, '');
	}
});

test('missing deadline extends the current implied rate to 100%, rounded up to a civil day', () => {
	const pace = percentagePace(input(40, { deadline: undefined }), '2026-10-07');
	assert.equal(pace.kind, 'open-ended'); close(pace.actualAverage, 40 / 3);
	assert.equal(pace.estimatedEnd, '2026-10-12'); assert.equal(pace.deadline, undefined);
	assert.equal(pace.requiredToday, undefined); assert.equal(pace.requiredAverage, undefined);
	const layout = paceLayout(pace);
	assert.ok(layout.actualPath); assert.ok(layout.estimatePath); assert.equal(layout.requiredPath, '');
	assert.equal(layout.to, pace.estimatedEnd);
	close((layout.y(0) - layout.current.y) / (layout.current.x - layout.x(pace.start)),
		(layout.current.y - layout.y(100)) / (layout.estimateX - layout.current.x));
	assert.equal(percentagePace(input(85, { deadline: '' }), '2026-10-10').estimatedEnd, '2026-10-12');
});

test('no finish estimate without elapsed time, positive progress or unfinished work', () => {
	for (const [progress, date] of [[40, '2026-10-03'], [40, '2026-10-04'], [0, '2026-10-07'], [100, '2026-10-07']]) {
		for (const deadline of [undefined, '2026-10-18']) {
			const pace = percentagePace(input(progress, { deadline }), date);
			assert.equal(pace.estimatedEnd, undefined); assert.equal(paceLayout(pace).estimatePath, '');
			assert.equal(pace.kind, deadline ? 'scheduled' : 'open-ended');
		}
	}
});

test('invalid deadlines do not silently become estimates, and extreme projections fail safely', () => {
	assert.equal(percentagePace(input(40, { deadline: 'bad' }), '2026-10-07').kind, 'unavailable');
	const pace = percentagePace({ progress: .00000001, start: '0001-01-01' }, '9999-12-31');
	assert.equal(pace.estimatedEnd, undefined); assert.equal(pace.message, 'Estimate outside supported dates');
	assert.doesNotMatch(paceLayout(pace).actualPath, /NaN|Infinity/);
});

test('same-day target is a point, not an infinite slope, for future/today/past schedules', () => {
	for (const date of ['2026-10-03', '2026-10-04', '2026-10-05']) {
		const pace = percentagePace(input(40, { deadline: '2026-10-04' }), date);
		assert.equal(pace.kind, 'same-day'); assert.equal(pace.requiredToday, date < '2026-10-04' ? 0 : 100);
		for (const field of ['requiredAverage', 'remainingRequired']) assert.equal(pace[field], undefined);
		assert.equal(paceLayout(pace).requiredPath, '');
		if (date > pace.start) {
			assert.equal(pace.actualAverage, 40); assert.equal(pace.estimatedEnd, '2026-10-07');
			assert.ok(paceLayout(pace).actualPath); assert.ok(paceLayout(pace).estimatePath);
		} else {
			assert.equal(pace.actualAverage, undefined); assert.equal(pace.estimatedEnd, undefined);
			assert.equal(paceLayout(pace).actualPath, '');
		}
	}
});

test('zero, tiny decimal, YAML Date, DST and civil-year boundary geometry remain finite', () => {
	const cases = [input(0), input(0.0001), input(100), input(40, { start: new Date('2026-10-04T00:00:00Z') }),
		input(40, { start: '2026-10-24', deadline: '2026-10-26' }), input(40, { start: '9999-12-31', deadline: '9999-12-31' })];
	for (const value of cases) {
		const pace = percentagePace(value, value.start === '9999-12-31' ? '9999-12-31' : '2026-10-25');
		for (const width of [180, 240, 409, 800]) {
			const layout = paceLayout(pace, width);
			assert.ok(Number.isFinite(layout.current.x)); assert.ok(Number.isFinite(layout.current.y));
			assert.doesNotMatch(layout.actualPath + layout.requiredPath + layout.estimatePath, /NaN|Infinity/);
		}
	}
	close(percentagePace(cases[4], '2026-10-25').requiredToday, 50);
	assert.equal(percentage(0.0001), '<0.01%'); assert.equal(paceRate(undefined), 'Unavailable');
});

test('defensive invalid canonical input produces no invalid SVG coordinates', () => {
	for (const progress of [-1, 101, NaN, Infinity]) {
		const pace = percentagePace(input(progress), '2026-10-07');
		assert.equal(pace.kind, 'unavailable'); assert.equal(pace.message, 'Fix progress');
		assert.equal(pace.progress, 0); assert.ok(Number.isFinite(paceLayout(pace).current.y));
	}
});
