import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({
	entryPoints: [fileURLToPath(new URL('../src/ui/tasks-model.ts', import.meta.url)),
		fileURLToPath(new URL('../src/ui/task-checkbox.ts', import.meta.url)),
		fileURLToPath(new URL('../src/ui/note-action-history.ts', import.meta.url))],
	bundle: true, write: false, format: 'esm', outdir: '/virtual',
});
const modules = new Map(compiled.outputFiles.map(file => [file.path.split('/').at(-1),
	import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)]));
const { openTaskText, projectTaskGroups } = await modules.get('tasks-model.js');
const { completeTaskSource, completeTaskCheckbox } = await modules.get('task-checkbox.js');
const { NoteActionHistory } = await modules.get('note-action-history.js');

const item = (line, parent, col, task) => ({ parent, task, position: {
	start: { line, col, offset: 0 }, end: { line, col: col + 10, offset: 10 },
} });

test('whole-note tasks and inline descendants appear once under their closest project', () => {
	const file = { basename: 'Project note', path: 'Project note.md' };
	const whole = { file, text: 'Project note' };
	const inline = { file, text: 'Inline project', line: 1, sourceLine: '- [ ] Inline project #project' };
	const cache = [item(1, -1, 0, ' '), item(2, 1, 2, ' '), item(3, 1, 2),
		item(4, 3, 4, ' '), item(5, -1, 0, ' '), item(6, -1, 0, 'x')];
	const content = ['# Project note', '- [ ] Inline project #project', '  - [ ] First',
		'  - Plain bullet', '    - [ ] Nested', '- [ ] Outside', '- [x] Done'].join('\n');
	const groups = projectTaskGroups([whole, inline], () => cache, () => content, () => []);
	assert.deepEqual(groups.map(group => [group.project.text, group.tasks.map(task => task.text)]), [
		['Inline project', ['First', 'Nested']], ['Project note', ['Inline project #project', 'Outside']],
	]);
	assert.deepEqual(groups.flatMap(group => group.tasks.map(task => task.line)), [2, 4, 1, 5]);
});

test('inline-only project claims recursive child tasks, excluding sibling and project checkbox', () => {
	const file = { basename: 'Mixed', path: 'Mixed.md' };
	const project = { file, text: 'Inline', line: 0 };
	const cache = [item(0, 0, 0, ' '), item(1, 0, 2, ' '), item(2, 0, 0, ' '), item(3, 2, 2, ' ')];
	const content = '- [ ] Inline #project\n  - [ ] Child\n- [ ] Other\n  - [ ] Other child';
	const groups = projectTaskGroups([project], () => cache, () => content, () => []);
	assert.deepEqual(groups.map(group => group.tasks.map(task => task.text)), [['Child']]);
});

test('nested inline project checkbox belongs to its parent, while descendants belong to the nested project', () => {
	const file = { basename: 'Mixed', path: 'Mixed.md' };
	const outer = { file, text: 'Outer', line: 0 };
	const inner = { file, text: 'Inner', line: 2 };
	const cache = [item(0, 0, 0, ' '), item(1, 0, 2, ' '), item(2, 0, 2, ' '), item(3, 2, 4, ' ')];
	const content = '- [ ] Outer #project\n  - [ ] First\n  - [ ] Inner #project\n    - [ ] Second';
	const groups = projectTaskGroups([outer, inner], () => cache, () => content, () => []);
	assert.deepEqual(groups.map(group => [group.project.text, group.tasks.map(task => task.line)]), [
		['Inner', [3]], ['Outer', [1, 2]],
	]);
});

test('the source checkbox controls visibility while cached task metadata catches up', () => {
	const file = { basename: 'Done', path: 'Done.md' };
	const project = { file, text: 'Done' };
	assert.deepEqual(projectTaskGroups([project], () => [item(0, 0, 0, ' ')], () => '- [x] Finished', () => []), []);
	assert.deepEqual(projectTaskGroups([project], () => [item(0, 0, 0, 'x')], () => '- [ ] Restored', () => [])
		.flatMap(group => group.tasks.map(task => task.text)), ['Restored']);
	assert.equal(openTaskText('> 2. [ ] Quoted task'), 'Quoted task');
	assert.equal(openTaskText('- [ ]'), 'Untitled task');
	assert.equal(openTaskText('- [x] Completed'), undefined);
});

test('tasks show the closest cached heading, with no heading before the first heading', () => {
	const file = { basename: 'Project', path: 'Project.md' };
	const project = { file, text: 'Project' };
	const content = ['- [ ] Before', '# First', '- [ ] First task', '## Nested',
		'- [ ] Nested task', '# Second', '- [ ] Second task'].join('\n');
	const items = [0, 2, 4, 6].map(line => item(line, -1, 0, ' '));
	const heading = (line, text, level) => ({ heading: text, level, position: {
		start: { line, col: 0, offset: 0 }, end: { line, col: text.length, offset: text.length },
	} });
	const headings = [heading(5, 'Second', 1), heading(1, 'First', 1), heading(3, 'Nested', 2)];
	const groups = projectTaskGroups([project], () => items, () => content, () => headings);
	assert.deepEqual(groups[0].tasks.map(task => task.heading), [undefined, 'First', 'Nested', 'Second']);
});

test('completion changes only the selected checkbox and retains CRLF and trailing content', () => {
	const source = '- [ ] First  #tag';
	const content = `# Title\r\n${source}\r\n- [ ] Second\r\n`;
	assert.equal(completeTaskSource(content, { path: 'A.md', line: 1, sourceLine: source }),
		'# Title\r\n- [x] First  #tag\r\n- [ ] Second\r\n');
});

test('completion relocates one exact moved line and rejects changed, ambiguous or completed lines', () => {
	const target = { path: 'A.md', line: 0, sourceLine: '- [ ] Do it' };
	assert.equal(completeTaskSource('Heading\n- [ ] Do it', target), 'Heading\n- [x] Do it');
	assert.throws(() => completeTaskSource('Heading\n- [ ] Do it\n- [ ] Do it', target), /changed/);
	assert.throws(() => completeTaskSource('- [ ] Different', target), /changed/);
	assert.throws(() => completeTaskSource('- [x] Do it', { ...target, sourceLine: '- [x] Do it' }), /no longer open/);
});

test('completion uses the vault process API and fails when the target note is gone', async () => {
	const file = { path: 'Project.md' };
	let content = '- [ ] Task';
	const app = { vault: {
		getFileByPath: path => path === file.path ? file : null,
		process: async (_, change) => { content = change(content); return content; },
	} };
	await completeTaskCheckbox(app, { path: file.path, line: 0, sourceLine: content });
	assert.equal(content, '- [x] Task');
	await assert.rejects(() => completeTaskCheckbox(app, { path: 'Missing.md', line: 0, sourceLine: '- [ ] Task' }), /no longer exists/);
});

test('task completion is one guarded undo/redo action', async () => {
	const file = { path: 'Project.md', basename: 'Project' };
	let content = '# Project\n- [ ] Task\n- [ ] Keep';
	const app = { vault: {
		getFileByPath: path => path === file.path ? file : null,
		process: async (_, change) => { content = change(content); return content; },
	}, fileManager: {}, metadataCache: {} };
	const history = new NoteActionHistory(app);
	const target = { path: file.path, line: 1, sourceLine: '- [ ] Task' };
	await history.record(tracked => completeTaskCheckbox(tracked, target));
	assert.equal(content, '# Project\n- [x] Task\n- [ ] Keep');
	assert.equal(await history.undo(), true);
	assert.equal(content, '# Project\n- [ ] Task\n- [ ] Keep');
	assert.equal(await history.redo(), true);
	assert.equal(content, '# Project\n- [x] Task\n- [ ] Keep');
	content = content.replace('- [x] Task', '- [x] Changed');
	await assert.rejects(history.undo(), /source line changed/);
	assert.equal(content, '# Project\n- [x] Changed\n- [ ] Keep');
});
