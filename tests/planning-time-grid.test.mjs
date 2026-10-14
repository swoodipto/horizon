import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { buildSync } = createRequire(import.meta.url)('esbuild');
const code = buildSync({
	entryPoints: [fileURLToPath(new URL('../src/calendar/time-grid.ts', import.meta.url))],
	bundle: true, write: false, format: 'esm',
}).outputFiles[0].text;
const { currentTimePosition } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('current-time marker uses local clock minutes and the visible day column', () => {
	const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];
	assert.deepEqual(currentTimePosition(new Date(2026, 9, 14, 16, 3, 30), days), {
		date: '2026-10-14', column: 2, fraction: (16 * 60 + 3.5) / 1440, label: '16:03',
	});
	assert.equal(currentTimePosition(new Date(2026, 9, 16, 16, 3), days), undefined);
});

test('midnight and late-night positions stay within the local civil day', () => {
	const days = ['2026-10-25'];
	assert.equal(currentTimePosition(new Date(2026, 9, 25, 0, 0), days)?.fraction, 0);
	assert.equal(currentTimePosition(new Date(2026, 9, 25, 23, 59, 59), days)?.label, '23:59');
	assert.ok(currentTimePosition(new Date(2026, 9, 25, 23, 59, 59), days).fraction < 1);
});
