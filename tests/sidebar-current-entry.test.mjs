import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const code = buildSync({ entryPoints: [fileURLToPath(new URL('../src/ui/sidebar-current-entry.ts', import.meta.url))],
	bundle: true, write: false, format: 'esm' }).outputFiles[0].text;
const { currentSidebarEntries } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('highlights the open whole-note goal and project without selecting unrelated entries', () => {
	const goal = { path: 'Plan.md', kind: 'goal' }, project = { path: 'Plan.md', kind: 'project' };
	const other = { path: 'Other.md', kind: 'project' };
	assert.deepEqual(currentSidebarEntries([goal, project, other], { path: 'Plan.md' }), [goal, project]);
	assert.deepEqual(currentSidebarEntries([goal, project, other], { path: 'Other.md' }), [other]);
});

test('highlights only the selected inline entry, or a sole inline entry for its open source note', () => {
	const first = { path: 'Inbox.md', line: 3 }, second = { path: 'Inbox.md', line: 9 };
	assert.deepEqual(currentSidebarEntries([first, second], { path: 'Inbox.md', line: 9 }), [second]);
	assert.deepEqual(currentSidebarEntries([first, second], { path: 'Inbox.md' }), []);
	assert.deepEqual(currentSidebarEntries([first], { path: 'Inbox.md' }), [first]);
	assert.deepEqual(currentSidebarEntries([first], undefined), []);
});
