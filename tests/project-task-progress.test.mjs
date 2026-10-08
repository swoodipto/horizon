import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { taskCache } from './task-fixtures.mjs';

const compiled = await build({
	entryPoints: [fileURLToPath(new URL('../src/ui/project-task-progress.ts', import.meta.url))],
	bundle: true, write: false, format: 'esm',
});
const { projectTaskProgress } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const item = (line, parent, col, task) => ({ parent, task, position: {
	start: { line, col, offset: 0 }, end: { line, col: col + 10, offset: 10 },
} });

test('whole-note progress counts every cached checkbox equally, including nested tasks', () => {
	const list = [item(2, -2, 0, 'x'), item(3, 2, 2, ' '), item(4, 3, 4, 'x'), item(5, -2, 0)];
	assert.equal(projectTaskProgress({}, list), 2 / 3 * 100);
	assert.equal(projectTaskProgress({}, undefined), 0);
	assert.equal(projectTaskProgress({}, [item(1, -1, 0)]), 0);
	assert.equal(projectTaskProgress({}, taskCache(0, 2)), 0);
	assert.equal(projectTaskProgress({}, taskCache(2, 2)), 100);
});

test('inline projects count recursive children through non-task bullets, excluding their own checkbox and siblings', () => {
	const list = [item(1, -1, 0, 'x'), item(2, 1, 2, ' '), item(3, 1, 2),
		item(4, 3, 4, 'x'), item(5, -1, 0, 'x'), item(6, 5, 2, 'x')];
	assert.equal(projectTaskProgress({ line: 1 }, list), 50);
	assert.equal(projectTaskProgress({ line: 5 }, list), 100);
	assert.equal(projectTaskProgress({ line: 2 }, list), 0);
	assert.equal(projectTaskProgress({ line: 9 }, list), 0);
});

test('a project on line zero does not claim other root-level items or their descendants', () => {
	const list = [item(0, -0, 0), item(1, 0, 2, 'x'), item(2, 0, 2, ' '),
		item(3, -0, 0, 'x'), item(4, 3, 2, 'x')];
	assert.equal(projectTaskProgress({ line: 0 }, list), 50);
});

test('native non-space checkbox marks count as completed, plain lists never do', () => {
	assert.equal(projectTaskProgress({}, [item(1, -1, 0, 'X'), item(2, -1, 0, '-'),
		item(3, -1, 0, '/'), item(4, -1, 0, ' '), item(5, -1, 0)]), 75);
});

test('cache ordering does not affect descendants, broken ancestry cannot recurse or claim tasks', () => {
	const list = [item(5, 4, 4, 'x'), item(4, 2, 2), item(2, -2, 0), item(8, 9, 4, 'x'), item(9, 8, 2, 'x')];
	assert.equal(projectTaskProgress({ line: 2 }, list), 100);
});
