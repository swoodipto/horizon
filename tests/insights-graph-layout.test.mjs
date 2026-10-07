import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { buildSync } = createRequire(import.meta.url)('esbuild');
const bundle = buildSync({
	entryPoints: [fileURLToPath(new URL('../src/insights/graph-layout.ts', import.meta.url))],
	bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2021', metafile: true,
});
const code = bundle.outputFiles[0].text;
const { graphLayout } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const unavailable = { kind: 'unavailable', message: 'Add a start date and deadline' };
const estimate = {
	kind: 'estimate', start: '2026-10-01', deadline: '2026-10-14', anchor: '2026-10-07',
	earlier: '2026-10-09', finish: '2026-10-11', later: '2026-10-13', velocity: 5, duration: 4.9,
};
const point = (date, properties = {}) => ({
	at: Date.parse(`${date}T12:00:00Z`), date, scope: 10, started: 2, completed: 5, progress: 60,
	...properties,
});
const numbers = path => (path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []).map(Number);
const moves = path => path.match(/\bM\b/g)?.length ?? 0;
const cubics = path => path.match(/\bC\b/g)?.length ?? 0;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const sampleDates = layout => layout.samples.map(sample => sample.point.date);

test('layout bundles for browsers with only the shared civil-date runtime helper', () => {
	assert.deepEqual(Object.keys(bundle.metafile.inputs).sort(), ['src/insights/graph-layout.ts', 'src/planning/dates.ts']);
	assert.equal(Object.values(bundle.metafile.outputs).some(output => output.imports.length), false);
});

test('domain includes actual endpoints, today, schedule and every scenario finish', () => {
	const layout = graphLayout([point('2026-09-25'), point('2026-10-07')],
		{ ...estimate, later: '2026-10-25' }, '2026-10-20');
	assert.equal(layout.from, '2026-09-25');
	assert.equal(layout.to, '2026-10-25');
	assert.equal(layout.width, 409);
	assert.equal(layout.height, 170);
	near(layout.deadlineX, layout.x(estimate.deadline));
	assert.equal(layout.x('2026-09-01'), layout.x(layout.from));
	assert.equal(layout.x('2026-11-01'), layout.x(layout.to));
	assert.equal(graphLayout([], { ...unavailable, start: '2026-09-01' }, '2026-10-07').from, '2026-09-01');
});

test('empty history keeps scales and a valid deadline but creates no actual or forecast curves', () => {
	const layout = graphLayout([], { ...unavailable, deadline: '2026-10-14' }, '2026-10-07');
	assert.deepEqual(layout.samples, []);
	for (const name of ['scopePath', 'startedPath', 'completedPath', 'areaPath']) assert.equal(layout[name], '');
	assert.deepEqual(graphLayout([], estimate, '2026-10-07').forecastPaths, []);
	assert.equal(layout.max, 1);
	assert.equal(layout.deadlineX, layout.x('2026-10-14'));
	assert.equal(layout.to, '2026-10-14');
});

test('a first observation is only a real point, never a synthetic zero-to-current history', () => {
	const current = point('2026-10-07');
	const layout = graphLayout([current], estimate, current.date);
	assert.equal(layout.from, estimate.start);
	assert.deepEqual(layout.samples.map(sample => sample.point), [current]);
	for (const path of [layout.scopePath, layout.startedPath, layout.completedPath]) {
		assert.equal(moves(path), 1);
		assert.equal(cubics(path), 0);
		assert.equal(numbers(path).length, 2);
	}
	assert.equal(layout.areaPath, '');
	assert.equal(layout.forecastPaths.length, 3);
});

test('a same-date domain pads safely at ordinary and extreme calendar dates', () => {
	for (const [date, from, to] of [
		['2026-10-07', '2026-10-06', '2026-10-08'],
		['0001-01-01', '0001-01-01', '0001-01-02'],
		['9999-12-31', '9999-12-30', '9999-12-31'],
	]) {
		const layout = graphLayout([point(date)], unavailable, date);
		assert.equal(layout.from, from);
		assert.equal(layout.to, to);
		assert.ok(Number.isFinite(layout.x(date)));
		assert.ok(layout.x(from) < layout.x(to));
	}
});

test('civil-date spacing is uniform across leap days, year changes and DST', () => {
	const original = process.env.TZ;
	try {
		for (const zone of ['Europe/Berlin', 'America/Los_Angeles']) {
			process.env.TZ = zone;
			for (const dates of [
				['2024-02-28', '2024-02-29', '2024-03-01'],
				['2026-12-31', '2027-01-01', '2027-01-02'],
				['2026-03-28', '2026-03-29', '2026-03-30'],
				['2026-10-24', '2026-10-25', '2026-10-26'],
			]) {
				const layout = graphLayout(dates.map(date => point(date)), unavailable, dates[1]);
				near(layout.x(dates[1]) - layout.x(dates[0]), layout.x(dates[2]) - layout.x(dates[1]));
			}
		}
	} finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test('seven-day sampling keeps real first/latest bucket points plus a real current-day point', () => {
	const points = Array.from({ length: 21 }, (_, index) => point(`2026-10-${String(index + 1).padStart(2, '0')}`));
	const layout = graphLayout(points, unavailable, '2026-10-11');
	assert.deepEqual(sampleDates(layout), ['2026-10-01', '2026-10-07', '2026-10-08',
		'2026-10-11', '2026-10-14', '2026-10-15', '2026-10-21']);
	for (const sample of layout.samples) assert.ok(points.includes(sample.point));
	assert.equal(layout.samples.length, 7);
	assert.equal(cubics(layout.completedPath), 6);
});

test('sparse buckets choose actual dates, not scheduled or synthetic weekly boundaries', () => {
	const points = ['2026-10-02', '2026-10-04', '2026-10-06', '2026-10-10', '2026-10-13'].map(date => point(date));
	const layout = graphLayout(points, estimate, '2026-10-14');
	assert.deepEqual(sampleDates(layout), ['2026-10-02', '2026-10-06', '2026-10-10', '2026-10-13']);
	assert.equal(layout.samples.some(sample => sample.point.date === '2026-10-14'), false);
});

test('unsorted repeated dates use latest timestamps and input order only to break ties', () => {
	const early = point('2026-10-01', { at: 1, completed: 1 });
	const latest = point('2026-10-01', { at: 3, completed: 3 });
	const tie = point('2026-10-01', { at: 3, completed: 4 });
	const second = point('2026-10-02');
	const input = Object.freeze([Object.freeze(second), Object.freeze(latest), Object.freeze(early), Object.freeze(tie)]);
	const before = JSON.stringify(input);
	const layout = graphLayout(input, unavailable, '2026-10-02');
	assert.deepEqual(layout.samples.map(sample => sample.point), [tie, second]);
	assert.equal(JSON.stringify(input), before);
	assert.equal(cubics(layout.completedPath), 1);
});

test('gap points and both continuity endpoints survive downsampling inside a bucket', () => {
	const points = Array.from({ length: 7 }, (_, index) => point(`2026-10-0${index + 1}`, { gap: index === 3 }));
	const layout = graphLayout(points, unavailable, '2026-10-07');
	assert.deepEqual(sampleDates(layout), ['2026-10-01', '2026-10-03', '2026-10-04', '2026-10-07']);
	for (const path of [layout.scopePath, layout.startedPath, layout.completedPath]) {
		assert.equal(moves(path), 2);
		assert.equal(cubics(path), 2);
	}
	assert.equal(moves(layout.areaPath), 2);
	assert.equal((layout.areaPath.match(/\bZ\b/g) ?? []).length, 2);
});

test('deduplicating same-day points never erases an earlier gap flag', () => {
	const latest = point('2026-10-03', { at: 3 });
	const layout = graphLayout([point('2026-10-01'), point('2026-10-02'),
		point('2026-10-03', { at: 2, gap: true }), latest, point('2026-10-04')], unavailable, '2026-10-04');
	assert.equal(layout.samples[2].point, latest);
	assert.equal(moves(layout.completedPath), 2);
	assert.equal(cubics(layout.completedPath), 2);
});

test('a whole unknown week is not bridged, while a seven-day real interval can connect', () => {
	const broken = graphLayout([point('2026-10-01'), point('2026-10-09')], unavailable, '2026-10-09');
	assert.equal(moves(broken.completedPath), 2);
	assert.equal(cubics(broken.completedPath), 0);
	assert.equal(broken.areaPath, '');
	const known = graphLayout([point('2026-10-01'), point('2026-10-08')], unavailable, '2026-10-08');
	assert.equal(moves(known.completedPath), 1);
	assert.equal(cubics(known.completedPath), 1);
});

test('yellow uses started plus completed, while the purple curve uses completed only', () => {
	const layout = graphLayout([point('2026-10-07')], unavailable, '2026-10-07');
	near(numbers(layout.startedPath)[1], layout.y(7));
	near(numbers(layout.completedPath)[1], layout.y(5));
	near(numbers(layout.scopePath)[1], layout.y(10));
});

test('bounded cubic controls and evaluated curves never overshoot either endpoint', () => {
	const points = [point('2026-10-01', { scope: 20, completed: 0 }),
		point('2026-10-04', { scope: 20, completed: 20 }), point('2026-10-07', { completed: 2 })];
	const layout = graphLayout(points, unavailable, '2026-10-04');
	for (const path of [layout.scopePath, layout.startedPath, layout.completedPath]) {
		const values = numbers(path);
		let [x0, y0] = values;
		for (let index = 2; index < values.length; index += 6) {
			const [x1, y1, x2, y2, x3, y3] = values.slice(index, index + 6);
			near(x1, x2); near(x1, (x0 + x3) / 2); near(y1, y0); near(y2, y3);
			for (let step = 0; step <= 100; step++) {
				const t = step / 100, s = 1 - t;
				const x = s ** 3 * x0 + 3 * s ** 2 * t * x1 + 3 * s * t ** 2 * x2 + t ** 3 * x3;
				const y = s ** 3 * y0 + 3 * s ** 2 * t * y1 + 3 * s * t ** 2 * y2 + t ** 3 * y3;
				assert.ok(x >= x0 - 1e-8 && x <= x3 + 1e-8);
				assert.ok(y >= Math.min(y0, y3) - 1e-8 && y <= Math.max(y0, y3) + 1e-8);
			}
			[x0, y0] = [x3, y3];
		}
	}
});

test('forecast projections begin at anchor/current completed and end at current, not historic, scope', () => {
	const layout = graphLayout([point('2026-10-01', { scope: 20, completed: 15 }),
		point('2026-10-07')], estimate, '2026-10-07');
	assert.equal(layout.max, 20);
	assert.equal(layout.forecastPaths.length, 3);
	for (const [index, finish] of [estimate.earlier, estimate.finish, estimate.later].entries()) {
		assert.deepEqual(numbers(layout.forecastPaths[index]), [layout.x(estimate.anchor), layout.y(5), layout.x(finish), layout.y(10)]);
	}
	const future = graphLayout([point('2026-10-07')], { ...estimate, start: '2026-10-20', anchor: '2026-10-20',
		earlier: '2026-10-22', finish: '2026-10-24', later: '2026-10-26' }, '2026-10-07');
	assert.equal(numbers(future.forecastPaths[0])[0], future.x('2026-10-20'));
	assert.deepEqual(sampleDates(future), ['2026-10-07']);
});

test('same-day forecasts defer to endpoint markers, and duplicate scenario dates do not repeat curves', () => {
	const sameDay = graphLayout([point('2026-10-07')], { ...estimate, earlier: estimate.anchor,
		finish: estimate.anchor, later: estimate.anchor }, '2026-10-07');
	assert.deepEqual(sameDay.forecastPaths, []);
	const duplicate = graphLayout([point('2026-10-07')], { ...estimate, earlier: estimate.finish,
		later: estimate.finish }, '2026-10-07');
	assert.equal(duplicate.forecastPaths.length, 1);
	for (const forecast of [unavailable, { kind: 'completed', message: 'Completed', deadline: '2026-10-06' }]) {
		assert.deepEqual(graphLayout([point('2026-10-07')], forecast, '2026-10-07').forecastPaths, []);
	}
});

test('tiny or malformed dimensions and counts still yield finite bounded geometry', () => {
	for (const [width, height] of [[1, 1], [12, 8], [0, -5], [NaN, Infinity], [Number.MAX_VALUE, Number.MAX_VALUE]]) {
		const layout = graphLayout([point('2026-10-01', { scope: -4, started: -3, completed: -2 }),
			point('2026-10-07', { scope: 4, started: 100, completed: 100 })], estimate, '2026-10-07', width, height);
		for (const path of [layout.scopePath, layout.startedPath, layout.completedPath, layout.areaPath, ...layout.forecastPaths]) {
			assert.doesNotMatch(path, /NaN|Infinity/);
			const values = numbers(path);
			for (const [index, value] of values.entries()) assert.ok(value >= 0 && value <= (index % 2 ? layout.height : layout.width));
		}
		for (const value of [-1, 0, 4, 100, NaN, Infinity]) assert.ok(Number.isFinite(layout.y(value)));
		assert.equal(layout.y(-1), layout.y(0));
		assert.equal(layout.y(100), layout.y(layout.max));
		assert.ok(layout.x(layout.from) < layout.x(layout.to));
	}
	const invalid = graphLayout([point('bad'), point('2026-10-07', { scope: NaN, started: Infinity, completed: -1 })],
		{ ...unavailable, start: 'bad', deadline: '2026-02-30' }, 'bad');
	assert.equal(invalid.samples.length, 1);
	assert.equal(invalid.deadlineX, undefined);
	assert.ok(Number.isFinite(invalid.x('bad')));
	assert.doesNotMatch(invalid.startedPath, /NaN|Infinity/);
});
