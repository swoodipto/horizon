import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
const code = buildSync({ entryPoints: [fileURLToPath(new URL('../src/ui/deadline.ts', import.meta.url))], bundle: true, write: false, format: 'esm' }).outputFiles[0].text;
const { formatDeadline, formatStartDate, deadlineDaysLeft, setDeadline, setNoteDate } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
function fixture(properties = {}) {
 const file = { path: 'Plan.md' };
 const calls = [];
 return { properties, calls, app: {
  vault: { getFileByPath: path => path === file.path ? file : null },
  fileManager: { processFrontMatter: async (target, callback) => { assert.equal(target, file); calls.push(target.path); callback(properties); } },
 } };
}
test('deadline display uses the requested date format without timezone shifts', () => {
 assert.equal(formatDeadline('2026-10-05'), '5 Oct 2026');
 assert.equal(formatDeadline('2026-01-01'), '1 Jan 2026');
 assert.equal(formatDeadline(new Date('2026-12-31T00:00:00Z')), '31 Dec 2026');
 assert.equal(formatDeadline('2024-02-29'), '29 Feb 2024');
 for (const value of [undefined, '', '2026-02-29', '5 Oct 2026', 1]) assert.equal(formatDeadline(value), undefined);
});
test('setting and changing a deadline preserves unrelated frontmatter', async () => {
 const { app, properties, calls } = fixture({ tags: ['goal', 'project'], deadline: new Date('2026-10-01'), 'start date': '2026-09-01', custom: ['keep'], parent: '[[Work]]' });
 await setDeadline(app, 'Plan.md', '2026-10-05');
 assert.deepEqual(properties, { tags: ['goal', 'project'], deadline: '2026-10-05', 'start date': '2026-09-01', custom: ['keep'], parent: '[[Work]]' });
 assert.deepEqual(calls, ['Plan.md']);
});
test('clearing a deadline removes only that property and can be repeated', async () => {
 const { app, properties } = fixture({ deadline: '2026-10-05', 'start date': '2026-10-01', tags: ['goal'] });
 await setDeadline(app, 'Plan.md', '');
 await setDeadline(app, 'Plan.md', '');
 assert.deepEqual(properties, { 'start date': '2026-10-01', tags: ['goal'] });
});
test('invalid dates and deleted notes fail without writing', async () => {
 const { app, properties, calls } = fixture({ deadline: '2026-10-05' });
 await assert.rejects(setDeadline(app, 'Plan.md', '2026-02-30'), /valid calendar/);
 await assert.rejects(setDeadline(app, 'Missing.md', '2026-10-06'), /no longer exists/);
 assert.deepEqual(calls, []);
 assert.equal(properties.deadline, '2026-10-05');
});
test('deadline cannot precede an existing start date', async () => {
 const { app, properties } = fixture({ 'start date': new Date('2026-10-05'), deadline: '2026-10-10' });
 await assert.rejects(setDeadline(app, 'Plan.md', '2026-10-04'), /before the start/);
 assert.equal(properties.deadline, '2026-10-10');
 await setDeadline(app, 'Plan.md', '2026-10-05');
 assert.equal(properties.deadline, '2026-10-05');
});

test('remaining days handle singular, today, overdue and civil date boundaries', () => {
 assert.equal(deadlineDaysLeft('2026-10-12', '2026-10-05'), '7d left');
 assert.equal(deadlineDaysLeft('2026-10-06', '2026-10-05'), '1d left');
 assert.equal(deadlineDaysLeft('2026-10-05', '2026-10-05'), 'today');
 assert.equal(deadlineDaysLeft('2026-10-04', '2026-10-05'), '1d overdue');
 assert.equal(deadlineDaysLeft('2026-10-01', '2026-10-05'), '4d overdue');
 assert.equal(deadlineDaysLeft('2027-01-01', '2026-12-31'), '1d left');
 assert.equal(deadlineDaysLeft('2026-03-30', '2026-03-28'), '2d left');
 assert.equal(deadlineDaysLeft('2024-03-01', '2024-02-28'), '2d left');
 assert.equal(deadlineDaysLeft('', '2026-10-05'), undefined);
});

test('start date saves and clears only start and validates against deadline', async () => {
 const { app, properties } = fixture({ deadline:'2026-10-10', tags:['goal'], parent:'[[Work]]' });
 await setNoteDate(app, 'Plan.md', 'start', '2026-10-05');
 assert.equal(properties['start date'], '2026-10-05');
 await assert.rejects(setNoteDate(app, 'Plan.md', 'start', '2026-10-11'), /before the start/);
 assert.equal(properties['start date'], '2026-10-05');
 await setNoteDate(app, 'Plan.md', 'start', '');
 assert.deepEqual(properties, {deadline:'2026-10-10',tags:['goal'],parent:'[[Work]]'});
});

test('start-date badge matches the supplied day and abbreviated month format', () => {
 assert.equal(formatStartDate('2026-11-02'), '2. Nov');
 assert.equal(formatStartDate('2026-10-05'), '5. Oct');
 assert.equal(formatStartDate(new Date('2026-01-01T00:00:00Z')), '1. Jan');
 assert.equal(formatStartDate('2026-02-30'), undefined);
 assert.equal(formatStartDate(undefined), undefined);
});
