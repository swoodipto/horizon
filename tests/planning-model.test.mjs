import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function load(path) {
	const code = buildSync({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, format: 'esm' }).outputFiles[0].text;
	return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const { parseDate, today, addDays, addMonths, startOfMonth, startOfWeek, daysInMonth, dayDifference, projectRange, shiftProjectDates } = await load('../src/planning/dates.ts');
const { planningWarnings } = await load('../src/planning/dependencies.ts');
const project = (title, dates = {}, dependencies = [], status = 'todo') => ({ id: title, path: `${title}.md`, title, status, dependencies, ...dates });
const dep = title => ({ title, path: `${title}.md` });

test('strict dates validate calendar days and Gregorian leap years', () => {
	for (const date of ['2024-02-29', '2000-02-29', '2026-10-05', '0001-01-01']) assert.equal(parseDate(date), date);
	for (const date of ['1900-02-29', '2025-02-29', '2026-04-31', '2026-00-01', '2026-01-00', '0000-01-01', '2026-1-2', ' 2026-01-02', '2026-01-02T00:00:00Z', null, 42, new Date(NaN)]) assert.equal(parseDate(date), undefined);
});

test('YAML date-only values preserve UTC calendar day while today uses the local day', () => {
	const prior = process.env.TZ;
	try {
		process.env.TZ = 'America/Los_Angeles';
		assert.equal(parseDate(new Date('2026-10-05T00:00:00Z')), '2026-10-05');
		const now = new Date();
		assert.equal(today(), `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
	} finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
});

test('civil arithmetic crosses DST changes, leap days and small years without timezone drift', () => {
	const prior = process.env.TZ;
	try {
		process.env.TZ = 'America/Los_Angeles';
		assert.equal(dayDifference('2026-03-07', '2026-03-09'), 2);
		assert.equal(dayDifference('2026-10-31', '2026-11-02'), 2);
		assert.equal(addDays('2026-03-08', 1), '2026-03-09');
		assert.equal(addDays('2024-03-01', -1), '2024-02-29');
		assert.equal(addDays('0001-01-01', 1), '0001-01-02');
		assert.equal(dayDifference('2024-01-01', '2023-12-31'), -1);
	} finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
});

test('month navigation clamps the date and week navigation starts on Monday', () => {
	assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
	assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
	assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
	assert.equal(addMonths('2026-12-31', 1), '2027-01-31');
	assert.equal(startOfMonth('2026-10-05'), '2026-10-01');
	assert.equal(startOfWeek('2026-10-04'), '2026-09-28');
	assert.equal(startOfWeek('2026-10-05'), '2026-10-05');
	assert.equal(daysInMonth('2024-02-01'), 29);
});

test('range fallback renders either date and moving it preserves the missing property', () => {
	assert.equal(projectRange({}), undefined);
	for (const dates of [{ start: '2026-10-05' }, { deadline: '2026-10-05' }]) {
		assert.deepEqual(projectRange(dates), { start: '2026-10-05', end: '2026-10-05' });
		assert.deepEqual(shiftProjectDates(project('A', dates), 3), Object.fromEntries(Object.keys(dates).map(field => [field, '2026-10-08'])));
	}
	assert.deepEqual(projectRange({ start: '2026-10-05', deadline: '2026-10-10' }), { start: '2026-10-05', end: '2026-10-10' });
});

test('finish-to-start warnings require the day after a dependency ends and never mutate dates', () => {
	const a = project('A', { start: '2026-10-10' }, [dep('B')]);
	const b = project('B', { deadline: '2026-10-10' });
	const before = JSON.stringify([a, b]);
	assert.match(planningWarnings([a, b])[0].message, /after “B”.*2026-10-10/);
	assert.equal(JSON.stringify([a, b]), before);
	a.start = '2026-10-11';
	assert.deepEqual(planningWarnings([a, b]), []);
	a.start = '2026-10-09'; b.status = 'completed';
	assert.deepEqual(planningWarnings([a, b]), []);
});

test('invalid/reversed dates, undated dependencies, missing refs and non-project refs warn', () => {
	const a = project('A', { start: '2026-10-10', deadline: '2026-10-05', invalidDates: ['custom'] }, [dep('B'), dep('Missing'), { title: 'Unresolved' }]);
	const warnings = planningWarnings([a, project('B')]);
	assert.ok(warnings.some(warning => /Deadline is before/.test(warning.message)));
	assert.ok(warnings.some(warning => /Invalid custom/.test(warning.message)));
	assert.ok(warnings.some(warning => /Plan “B”/.test(warning.message)));
	assert.equal(warnings.filter(warning => /missing or is not a project note/.test(warning.message)).length, 2);
	assert.match(planningWarnings([project('A', {}, [dep('B')]), project('B', { start: '2026-10-05' })])[0].message, /Plan this project/);
	assert.match(planningWarnings([project('A', { start: '2026-02-30' })])[0].message, /Invalid start/);
});

test('cycle detection marks all strongly connected members including branches and self-loops', () => {
	const projects = [project('A', {}, [dep('B'), dep('C')]), project('B', {}, [dep('A')]), project('C', {}, [dep('B')]), project('D', {}, [dep('A')]), project('E', {}, [dep('E')])];
	assert.deepEqual(planningWarnings(projects).filter(warning => warning.kind === 'cycle').map(warning => warning.projectId).sort(), ['A', 'B', 'C', 'E']);
});
