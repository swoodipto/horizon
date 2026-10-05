import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { buildSync } = createRequire(import.meta.url)('esbuild');
const code = buildSync({
	entryPoints: [fileURLToPath(new URL('../src/calendar/layout.ts', import.meta.url))],
	bundle: true, write: false, format: 'esm',
}).outputFiles[0].text;
const { calendarWeek, calendarWeeks, yearMonths } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const project = (id, start, deadline) => ({ id, title: id, path: `${id}.md`, status: 'todo', dependencies: [], start, deadline });

test('month projects continue across weeks with inclusive dates and clipped widths', () => {
	const weeks = calendarWeeks('2026-10-01', 'month', [project('Launch', '2026-09-30', '2026-10-06')]);
	assert.equal(weeks[0].start, '2026-09-28');
	const first = weeks[0].segments[0];
	const second = weeks[1].segments[0];
	assert.deepEqual([first.column, first.length, first.continuesBefore, first.continuesAfter], [2, 5, false, true]);
	assert.deepEqual([second.column, second.length, second.continuesBefore, second.continuesAfter], [0, 2, true, false]);
	assert.equal(weeks.at(-1).days.at(-1), '2026-11-01');
});

test('sharing a deadline date occupies separate lanes, while the following day reuses one', () => {
	const week = calendarWeek('2026-10-05', 7, [
		project('A', '2026-10-05', '2026-10-07'), project('B', '2026-10-07', '2026-10-09'),
		project('C', '2026-10-08', '2026-10-10'),
	]);
	assert.deepEqual(week.segments.map(item => [item.project.id, item.lane]), [['A', 0], ['B', 1], ['C', 0]]);
	assert.equal(week.lanes, 2);
});

test('either missing date falls back to a single calendar day; undated and reversed dates remain off calendar', () => {
	const week = calendarWeek('2026-10-05', 7, [
		project('Start only', '2026-10-06'), project('Deadline only', undefined, '2026-10-08'),
		project('Unplanned'), project('Reversed', '2026-10-09', '2026-10-06'),
	]);
	assert.deepEqual(week.segments.map(item => [item.project.id, item.column, item.length]), [['Start only', 1, 1], ['Deadline only', 3, 1]]);
});

test('overlapping single-day projects all remain visible without a fixed overflow limit', () => {
	const week = calendarWeek('2026-10-05', 7, Array.from({ length: 12 }, (_, index) => project(`Project ${index}`, '2026-10-07')));
	assert.equal(week.lanes, 12);
	assert.equal(new Set(week.segments.map(item => item.lane)).size, 12);
});

test('day, four-day, and week views preserve civil dates across the daylight saving transition', () => {
	assert.deepEqual(calendarWeeks('2026-10-24', 'four-days', [])[0].days, ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
	assert.deepEqual(calendarWeeks('2026-10-25', 'day', [])[0].days, ['2026-10-25']);
	assert.equal(calendarWeeks('2026-10-25', 'week', [])[0].start, '2026-10-19');
});

test('leap-year month coverage and twelve-month year overview stay within their displayed year', () => {
	const weeks = calendarWeeks('2028-02-29', 'month', []);
	assert.ok(weeks.flatMap(week => week.days).includes('2028-02-29'));
	const months = yearMonths('2028-12-31');
	assert.equal(months.length, 12);
	assert.equal(months[0], '2028-01-01');
	assert.equal(months.at(-1), '2028-12-01');
});
