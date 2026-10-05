import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { buildSync } = createRequire(import.meta.url)('esbuild');
const code = buildSync({ entryPoints: [fileURLToPath(new URL('../src/planning/state.ts', import.meta.url))], bundle: true, write: false, format: 'esm' }).outputFiles[0].text;
const { planningState } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('switching planning options retains the last calendar mode, visible date and timeline scale', () => {
	const previous = { optionId: 'upcoming', date: '2026-10-05', mode: 'week', scale: 'year', zoom: 3 };
	assert.deepEqual(planningState({ optionId: 'timeline' }, previous), { ...previous, optionId: 'timeline' });
});

test('invalid persisted view values cannot create invalid dates, modes or infinite timeline geometry', () => {
	const previous = { optionId: 'upcoming', date: '2026-10-05', mode: 'week', scale: 'year', zoom: 3 };
	assert.deepEqual(planningState({ date: '2026-02-31', mode: 'hour', scale: 'day', zoom: Infinity, optionId: 'projects' }, previous), previous);
	assert.equal(planningState({ zoom: -100 }, previous).zoom, 0.5);
	assert.equal(planningState({ zoom: 100 }, previous).zoom, 8);
});
