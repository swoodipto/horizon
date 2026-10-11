import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { build } = createRequire(import.meta.url)('esbuild');
const code = (await build({ stdin: { contents: `export * from './goal-completion'; export * from './project-status'; export * from './completed-items'; export * from './inline-project-dates'; export * from './tagged-notes'; export * from './goal-progress'; export * from './note-action-history'; export * from '../insights/types'; export * from '../planning/dates';`, resolveDir: fileURLToPath(new URL('../src/ui/', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm' })).outputFiles[0].text;
const { goalCompletionTags, setGoalCompletion, setLineGoalCompletion, setLineStatus, setProjectStatus, setProjectProperties, projectStatusForTags, newestCompletedFirst, inlineProjectDates, findTaggedEntries, goalProgress, visiblePaceEntry, NoteActionHistory, today } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const target = sourceLine => ({ path: 'Note.md', line: 0, sourceLine });
const fixture = (tags = ['goal'], content = '') => {
 const file = { path: 'Note.md', basename: 'Note' }, properties = { tags, other: 7 };
 const state = { content };
 const app = { vault: { getFileByPath: path => path === file.path ? file : null, process: async (_, fn) => (state.content = fn(state.content)) }, metadataCache: {}, fileManager: { processFrontMatter: async (_, fn) => fn(properties) } };
 return { app, file, properties, state };
};

test('goal tag actions retain unrelated tags and preserve the dual project status', () => {
 const tags = goalCompletionTags(['goal', 'project', 'doing', 'client'], true);
 assert.equal(projectStatusForTags(tags).tag, 'doing');
 assert.ok(tags.includes('completed'));
 assert.deepEqual(goalCompletionTags(tags, false), ['goal', 'project', 'doing', 'client']);
 assert.deepEqual(goalCompletionTags(['goal', 'completed/later'], false), ['goal', 'completed/later']);
});
test('goal completion sets a date and reopening restores only owned fields', async () => {
 const f = fixture();
 await setGoalCompletion(f.app, { path: 'Note.md' }, true);
 assert.equal(f.properties['completed date'], today());
 assert.deepEqual(f.properties.tags, ['goal', 'completed']);
 f.properties['completed date'] = '2024-01-01';
 await setGoalCompletion(f.app, { path: 'Note.md' }, true);
 assert.equal(f.properties['completed date'], '2024-01-01');
 await setGoalCompletion(f.app, { path: 'Note.md' }, false);
 assert.deepEqual(f.properties, { tags: ['goal'], other: 7 });
});
test('project status transitions preserve a completed goal except tag-free Todo', () => {
 const props = { tags: ['goal', 'project', 'completed'], 'completed date': '2024-02-01' };
 for (const status of ['doing', 'ready', 'completed']) {
  setProjectProperties(props, status);
  assert.ok(props.tags.includes('completed'));
  assert.equal(projectStatusForTags(props.tags).tag, status);
  assert.equal(props['completed date'], '2024-02-01');
 }
 setProjectProperties(props, 'todo');
 assert.deepEqual(props, { tags: ['goal', 'project'] });
});
test('inline completion writes the exact line and preserves CRLF, suffixes and other entries', () => {
 const raw = '- Goal #goal ^anchor  ';
 const content = raw + '\r\n- Other #goal';
 const done = setLineGoalCompletion(content, target(raw), true);
 assert.equal(done, `- Goal #goal #completed [completed date:: ${today()}] ^anchor  \r\n- Other #goal`);
 const line = done.split('\r\n')[0];
 assert.equal(setLineGoalCompletion(done, target(line), false), content);
});
test('inline project completion records and clears dates without touching task checkboxes', () => {
 const raw = '- [ ] Work #project #doing';
 const done = setLineStatus(raw + '\n  - [ ] Child', target(raw), 'completed');
 assert.equal(inlineProjectDates(done.split('\n')[0]).completed, today());
 assert.ok(done.endsWith('\n  - [ ] Child'));
 const reopened = setLineStatus(done, target(done.split('\n')[0]), 'doing');
 assert.equal(reopened, raw + '\n  - [ ] Child');
});
test('inline dual goal completion retains Doing through later project changes', () => {
 const raw = '- Shared #goal #project #doing';
 const done = setLineGoalCompletion(raw, target(raw), true);
 assert.match(done, /#completed #doing/);
 const ready = setLineStatus(done, target(done), 'ready');
 assert.match(ready, /#completed/);
 assert.match(ready, /#ready/);
 assert.equal(inlineProjectDates(ready).completed, today());
});
test('source guard relocates a unique moved goal but rejects edits and ambiguous matches', () => {
 const raw = '- Goal #goal';
 assert.match(setLineGoalCompletion('Intro\n' + raw, target(raw), true), /^Intro\n- Goal #goal #completed/);
 assert.throws(() => setLineGoalCompletion('Changed #goal', target(raw), true), /changed/);
 assert.throws(() => setLineGoalCompletion('Intro\n' + raw + '\n' + raw, target(raw), true), /ambiguous/);
});
test('goal action ignores literal completion tags in code and comments and preserves nested tags', () => {
 const raw = '- Goal #goal `#completed` <!-- #completed --> #completed/later';
 const done = setLineGoalCompletion(raw, target(raw), true);
 const reopened = setLineGoalCompletion(done, target(done), false);
 assert.equal(reopened, raw);
});
test('completion date stays independent of broken schedule dates, duplicates fail closed', () => {
 const raw = '- Work #project [deadline:: invalid]';
 assert.equal(inlineProjectDates(setLineStatus(raw, target(raw), 'completed')).completed, today());
 const duplicate = '- Work #project [completed date:: 2024-01-01] [completed date:: 2024-02-01]';
 assert.throws(() => setLineStatus(duplicate, target(duplicate), 'completed'), /Repeated/);
});
test('classification uses each cached entry and exact case-insensitive completion tags', async () => {
 const content = '- Active #goal\n- Done #goal #COMPLETED\n- Nested #goal #completed/later';
 const file = { path: 'Note.md', basename: 'Note' };
 const lineTags = content.split('\n').flatMap((line, i) => [...line.matchAll(/#[\w/-]+/g)].map(match => ({ tag: match[0], position: { start: { line: i, col: match.index }, end: { line: i, col: match.index + match[0].length } } })));
 const entries = await findTaggedEntries([file], () => ({ noteTags: ['#goal', '#completed'], lineTags }), async () => content, '#goal', true);
 assert.equal(entries.find(e => e.line === undefined).completionTagged, true);
 assert.equal(entries.find(e => e.line === 0).completionTagged, undefined);
 assert.equal(entries.find(e => e.line === 1).completionTagged, true);
	assert.equal(entries.find(e => e.line === 1).text, 'Done');
 assert.equal(entries.find(e => e.line === 2).completionTagged, undefined);
});
test('completed goals count as 100 in parent roll-up and reopening recalculates', () => {
 const parent = { file: { path: 'Parent' }, text: 'Parent' };
 const child = { file: { path: 'Child' }, text: 'Child', parents: [{ path: 'Parent' }], completionTagged: true };
 let result = goalProgress([parent, child], [], () => 'todo', () => 0);
 assert.equal(result.get(child), 100); assert.equal(result.get(parent), 100);
 child.completionTagged = false;
 result = goalProgress([parent, child], [], () => 'todo', () => 0);
 assert.equal(result.get(child), 0); assert.equal(result.get(parent), 0);
});
test('Insights hides explicit completion but retains eligible measured 100 percent entries', () => {
 for (const kind of ['goal', 'project']) {
  assert.equal(visiblePaceEntry({ kind, start: '2024-01-01', progress: 100 }), true);
  assert.equal(visiblePaceEntry({ kind, start: '2024-01-01', progress: 100, completionTagged: true }), false);
 }
});
test('newest first uses valid dates and deterministic title order, undated last', () => {
 const entries = [['Z', '2024-01-01'], ['B', '2024-02-01'], ['A', '2024-02-01'], ['Empty', ''], ['Invalid', '2024-02-31']].map(([text, date]) => ({ text, date, file: { path: text } }));
 assert.deepEqual(newestCompletedFirst(entries, e => e.date).map(e => e.text), ['A', 'B', 'Z', 'Empty', 'Invalid']);
 assert.equal(entries[0].text, 'Z');
});
test('history restores completion tags and date together while retaining unrelated properties', async () => {
 const f = fixture(); const history = new NoteActionHistory(f.app);
 await history.record(app => setGoalCompletion(app, { path: 'Note.md' }, true));
 f.properties.other = 8;
 await history.undo(); assert.deepEqual(f.properties, { tags: ['goal'], other: 8 });
 await history.redo(); assert.equal(f.properties['completed date'], today()); assert.equal(f.properties.other, 8);
 f.properties['completed date'] = '2020-01-01';
 await assert.rejects(history.undo(), /changed since/);
});
test('inline history restores both completion and date without overwriting another line', async () => {
 const raw = '- Work #project'; const f = fixture(['area'], raw + '\nOther'); const history = new NoteActionHistory(f.app);
 await history.record(app => setProjectStatus(app, target(raw), 'completed'));
 f.state.content = f.state.content.replace('Other', 'Edited elsewhere');
 await history.undo(); assert.equal(f.state.content, raw + '\nEdited elsewhere');
 await history.redo(); assert.match(f.state.content, /#completed/); assert.ok(f.state.content.endsWith('Edited elsewhere'));
});
