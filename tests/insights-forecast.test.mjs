import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const code = buildSync({
	entryPoints: [fileURLToPath(new URL('../src/insights/forecast.ts', import.meta.url))],
	bundle: true, write: false, format: 'esm',
}).outputFiles[0].text;
const { goalForecast } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const snapshot = (changes = {}) => ({
	scope: 10, unstarted: 3, started: 2, completed: 5, progress: 60,
	start: '2026-10-01', deadline: '2026-10-14', ...changes,
});
const forecast = (changes = {}, date = '2026-10-07') => goalForecast(snapshot(changes), date);
const unstarted = (scope = 10) => ({ scope, unstarted: scope, started: 0, completed: 0, progress: 0 });

test('scope example uses the full inclusive schedule, quarter started credit and scenario bounds', () => {
	assert.deepEqual(forecast(), {
		kind: 'estimate', start: '2026-10-01', deadline: '2026-10-14',
		anchor: '2026-10-07', finish: '2026-10-11', earlier: '2026-10-09', later: '2026-10-13',
		velocity: 5, duration: 4.9,
	});
});

test('an entirely unstarted goal finishes on its inclusive deadline when evaluated at start', () => {
	const result = forecast(unstarted(), '2026-10-01');
	assert.equal(result.kind, 'estimate');
	assert.equal(result.velocity, 5);
	assert.equal(result.duration, 14);
	assert.equal(result.finish, '2026-10-14');
	assert.equal(result.earlier, '2026-10-09');
	assert.equal(result.later, '2026-10-20');
});

test('started items need one quarter of the time of otherwise identical unstarted items', () => {
	const pending = forecast({ ...unstarted(4), deadline: '2026-10-08' }, '2026-10-01');
	const started = forecast({ scope: 4, unstarted: 0, started: 4, completed: 0, progress: 50,
		deadline: '2026-10-08' }, '2026-10-01');
	assert.equal(started.velocity, pending.velocity);
	assert.equal(started.duration, pending.duration / 4);
	assert.equal(started.finish, '2026-10-02');
	assert.equal(started.earlier, '2026-10-02');
	assert.equal(started.later, '2026-10-03');
});

test('future starts anchor on the scheduled start despite current observed progress', () => {
	assert.deepEqual(forecast({}, '2026-09-20'), {
		kind: 'estimate', start: '2026-10-01', deadline: '2026-10-14',
		anchor: '2026-10-01', finish: '2026-10-05', earlier: '2026-10-03', later: '2026-10-07',
		velocity: 5, duration: 4.9,
	});
});

test('deadline-day and overdue goals retain planned velocity without clamping to deadline', () => {
	for (const [date, finish] of [['2026-10-14', '2026-10-18'], ['2026-10-20', '2026-10-24']]) {
		const result = forecast({}, date);
		assert.equal(result.kind, 'estimate');
		assert.equal(result.anchor, date);
		assert.equal(result.deadline, '2026-10-14');
		assert.equal(result.velocity, 5);
		assert.equal(result.duration, 4.9);
		assert.equal(result.finish, finish);
		assert.ok(result.finish > result.deadline);
	}
});

test('same-day schedules have one day of capacity, including future and overdue anchors', () => {
	for (const date of ['2026-10-06', '2026-10-07', '2026-10-08']) {
		const result = forecast({ ...unstarted(2), start: '2026-10-07', deadline: '2026-10-07' }, date);
		const anchor = date < '2026-10-07' ? '2026-10-07' : date;
		assert.equal(result.kind, 'estimate');
		assert.equal(result.anchor, anchor);
		assert.equal(result.velocity, 14);
		assert.equal(result.duration, 1);
		assert.equal(result.finish, anchor);
		assert.equal(result.earlier, anchor);
		assert.equal(result.later, date === '2026-10-08' ? '2026-10-09' : '2026-10-08');
	}
});

test('sub-day started durations never project earlier than the anchor', () => {
	const result = forecast({ scope: 1, unstarted: 0, started: 1, completed: 0, progress: 25,
		start: '2026-10-07', deadline: '2026-10-07' });
	assert.equal(result.kind, 'estimate');
	assert.equal(result.duration, 0.25);
	assert.equal(result.velocity, 7);
	assert.equal(result.earlier, result.anchor);
	assert.equal(result.finish, result.anchor);
	assert.equal(result.later, result.anchor);
});

test('missing date messages retain any valid endpoint without guessing its counterpart', () => {
	assert.deepEqual(forecast({ start: undefined, deadline: undefined }), {
		kind: 'unavailable', message: 'Add a start date and deadline',
	});
	assert.deepEqual(forecast({ start: undefined }), {
		kind: 'unavailable', message: 'Add a start date', deadline: '2026-10-14',
	});
	assert.deepEqual(forecast({ deadline: undefined }), {
		kind: 'unavailable', message: 'Add a deadline', start: '2026-10-01',
	});
	for (const missing of [undefined, null, '']) {
		assert.equal(forecast({ start: missing }).message, 'Add a start date');
		assert.equal(forecast({ deadline: missing }).message, 'Add a deadline');
		assert.equal(forecast({ start: missing, deadline: missing }).message, 'Add a start date and deadline');
	}
});

test('malformed, impossible and unsupported endpoints request date repairs', () => {
	const invalid = ['2026-02-29', '2026-04-31', '1900-02-29', '0000-01-01', '10000-01-01',
		'2026-1-1', ' 2026-10-01', '2026-10-01T00:00:00Z', ' ', 0, false, [], {}, new Date(NaN)];
	for (const value of invalid) {
		assert.deepEqual(forecast({ start: value }), {
			kind: 'unavailable', message: 'Fix goal dates', deadline: '2026-10-14',
		});
		assert.deepEqual(forecast({ deadline: value }), {
			kind: 'unavailable', message: 'Fix goal dates', start: '2026-10-01',
		});
	}
	assert.equal(forecast({ start: 'invalid', deadline: undefined }).message, 'Fix goal dates');
	assert.equal(forecast({ start: undefined, deadline: 'invalid' }).message, 'Fix goal dates');
	assert.deepEqual(forecast({ start: 'invalid', deadline: 'invalid' }), {
		kind: 'unavailable', message: 'Fix goal dates',
	});
});

test('a deadline before start is unavailable and preserves both valid source dates', () => {
	assert.deepEqual(forecast({ start: '2026-10-15' }), {
		kind: 'unavailable', message: 'Deadline precedes start date',
		start: '2026-10-15', deadline: '2026-10-14',
	});
});

test('completed goals suppress projection even without a valid schedule or evaluation date', () => {
	assert.deepEqual(forecast({ progress: 100 }), {
		kind: 'completed', message: 'Completed', start: '2026-10-01', deadline: '2026-10-14',
	});
	assert.deepEqual(forecast({ progress: 100, start: undefined, deadline: undefined }, 'invalid'), {
		kind: 'completed', message: 'Completed',
	});
	assert.deepEqual(forecast({ progress: 100, start: 'invalid' }), {
		kind: 'completed', message: 'Completed', deadline: '2026-10-14',
	});
	assert.equal(forecast({ progress: 100, start: '2026-10-15' }).kind, 'completed');
	assert.equal(forecast({ unstarted: 0, started: 0, completed: 10, progress: 99.999 }).kind, 'completed');
});

test('empty scope cannot produce a completed state or divide-by-zero estimate', () => {
	for (const progress of [0, 100]) {
		assert.deepEqual(forecast({ scope: 0, unstarted: 0, started: 0, completed: 0, progress }), {
			kind: 'unavailable', message: 'No work to estimate',
			start: '2026-10-01', deadline: '2026-10-14',
		});
	}
});

test('invalid counts, inconsistent scope and nonfinite or out-of-range progress fail safely', () => {
	for (const field of ['scope', 'unstarted', 'started', 'completed']) {
		for (const value of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			assert.equal(forecast({ [field]: value }).message, 'Estimate unavailable');
		}
	}
	for (const progress of [-1, 100.01, NaN, Infinity, -Infinity]) {
		assert.equal(forecast({ progress }).message, 'Estimate unavailable');
	}
	assert.equal(forecast({ scope: 9 }).kind, 'unavailable');
	assert.equal(forecast({ scope: 0 }).kind, 'unavailable');
	assert.equal(forecast({ scope: Number.MAX_SAFE_INTEGER, unstarted: Number.MAX_SAFE_INTEGER,
		started: 1, completed: 0 }).kind, 'unavailable');
});

test('the evaluation date must also be a supported civil date', () => {
	for (const date of ['invalid', '2026-02-30', '0000-01-01', '10000-01-01']) {
		assert.deepEqual(forecast({}, date), {
			kind: 'unavailable', message: 'Estimate unavailable',
			start: '2026-10-01', deadline: '2026-10-14',
		});
	}
});

test('any out-of-range scenario makes the forecast unavailable without throwing or wrapping', () => {
	for (const [start, deadline, date] of [
		['9999-12-31', '9999-12-31', '9999-12-31'], // Only the later scenario overflows.
		['9999-12-30', '9999-12-31', '9999-12-31'], // Central estimate overflows too.
		['0001-01-01', '9999-12-31', '0001-01-01'], // Extremely long range remains guarded.
	]) {
		assert.deepEqual(forecast({ ...unstarted(1), start, deadline }, date), {
			kind: 'unavailable', message: 'Estimate unavailable', start, deadline,
		});
	}
	const result = forecast({ scope: 1, unstarted: 0, started: 1, completed: 0, progress: 50,
		start: '9999-12-31', deadline: '9999-12-31' }, '9999-12-31');
	assert.equal(result.kind, 'estimate');
	assert.equal(result.later, '9999-12-31');
});

test('month, year, leap-day and small-year boundaries retain inclusive arithmetic', () => {
	for (const [start, deadline, duration] of [
		['2026-01-30', '2026-02-02', 4],
		['2026-12-30', '2027-01-02', 4],
		['2024-02-28', '2024-03-01', 3],
		['2000-02-28', '2000-03-01', 3],
		['1900-02-28', '1900-03-01', 2],
		['0001-01-01', '0001-01-03', 3],
	]) {
		const result = forecast({ ...unstarted(3), start, deadline }, start);
		assert.equal(result.kind, 'estimate');
		assert.equal(result.duration, duration);
		assert.equal(result.velocity, 21 / duration);
		assert.equal(result.finish, deadline);
		assert.ok(result.earlier >= result.anchor && result.earlier <= result.finish);
		assert.ok(result.later >= result.finish);
	}
});

test('civil forecasts are unchanged across DST and timezone boundaries', () => {
	const prior = process.env.TZ;
	try {
		for (const zone of ['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
			process.env.TZ = zone;
			for (const [start, deadline] of [
				['2026-03-28', '2026-03-30'], ['2026-10-24', '2026-10-26'],
				['2026-03-07', '2026-03-09'], ['2026-10-31', '2026-11-02'],
			]) {
				const result = forecast({ ...unstarted(1), start, deadline }, start);
				assert.equal(result.duration, 3);
				assert.equal(result.finish, deadline);
				assert.equal(result.velocity, 7 / 3);
			}
			assert.deepEqual(forecast({ start: new Date('2026-10-01T00:00:00Z'),
				deadline: new Date('2026-10-14T00:00:00Z') }), forecast());
		}
	} finally {
		if (prior === undefined) delete process.env.TZ;
		else process.env.TZ = prior;
	}
});

test('the optional evaluation date defaults to the shared local civil today helper', () => {
	const NativeDate = Date;
	const prior = process.env.TZ;
	try {
		process.env.TZ = 'America/Los_Angeles';
		globalThis.Date = class extends NativeDate {
			constructor(...args) { super(...(args.length ? args : ['2026-10-08T00:30:00Z'])); }
		};
		assert.deepEqual(goalForecast(snapshot()), forecast({}, '2026-10-07'));
	} finally {
		globalThis.Date = NativeDate;
		if (prior === undefined) delete process.env.TZ;
		else process.env.TZ = prior;
	}
});

test('weighted percentage does not replace work counts, even below 1% or just below 100%', () => {
	for (const progress of [0, 0.001, 99.999]) assert.deepEqual(forecast({ progress }), forecast());
	const changedPlan = forecast({ scope: 20, unstarted: 6, started: 4, completed: 10 });
	assert.equal(changedPlan.velocity, 10);
	assert.equal(changedPlan.duration, 4.9);
	assert.equal(changedPlan.finish, forecast().finish);
	const changedDates = forecast({ deadline: '2026-10-28' });
	assert.equal(changedDates.velocity, 2.5);
	assert.equal(changedDates.duration, 9.8);
	assert.equal(changedDates.finish, '2026-10-16');
});

test('integer durations do not gain an extra day from division-first floating-point drift', () => {
	const result = forecast({ scope: 25, unstarted: 7, started: 0, completed: 18, progress: 72,
		deadline: '2026-10-25' }, '2026-10-01');
	assert.equal(result.duration, 7);
	assert.equal(result.finish, '2026-10-07');
	for (const scope of [1, 3, 7, 10, 25, 100, 1000]) {
		assert.equal(forecast({ ...unstarted(scope), deadline: '2026-10-25' }, '2026-10-01').finish,
			'2026-10-25');
	}
});

test('forecasting is deterministic and does not mutate the snapshot or supplied Date values', () => {
	const start = new Date('2026-10-01T00:00:00Z');
	const deadline = new Date('2026-10-14T00:00:00Z');
	const input = Object.freeze(snapshot({ start, deadline }));
	const originalDates = [start.getTime(), deadline.getTime()];
	assert.deepEqual(goalForecast(input, '2026-10-07'), goalForecast(input, '2026-10-07'));
	assert.deepEqual([start.getTime(), deadline.getTime()], originalDates);
	assert.deepEqual(input, snapshot({ start, deadline }));
});
