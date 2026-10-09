import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
const code=buildSync({entryPoints:[fileURLToPath(new URL('../src/ui/date-entry-groups.ts',import.meta.url))],bundle:true,write:false,format:'esm'}).outputFiles[0].text;
const {groupEntriesByDate}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const treeCode=buildSync({entryPoints:[fileURLToPath(new URL('../src/ui/entry-tree.ts',import.meta.url))],bundle:true,write:false,format:'esm'}).outputFiles[0].text;
const {nestTaggedEntries,visibleEntryRelations}=await import(`data:text/javascript;base64,${Buffer.from(treeCode).toString('base64')}`);
const metadata=entry=>entry;
const entry=(id,status='todo',dates={})=>({id,status,...dates});
test('undated entries are first without heading and someday is always last',()=>{
 const undated=entry('Undated','doing');
 const someday=entry('Someday','someday',{start:'2026-10-01'});
 const dated=entry('Dated','waiting',{start:'2026-10-12'});
 const groups=groupEntriesByDate([someday,dated,undated],metadata);
 assert.deepEqual(groups.map(group=>group.label),[undefined,'Upcoming','Someday']);
 assert.deepEqual(groups.map(group=>group.entries),[[undated],[dated],[someday]]);
 assert.ok(groups.every(group=>group.nest));
});
test('upcoming is sorted ascending using start date then deadline as fallback',()=>{
 const entries=[entry('Last','doing',{start:'2026-11-01',deadline:'2026-10-01'}),
 entry('Deadline only','todo',{deadline:'2026-10-12'}),entry('First','ready',{start:'2026-10-05'}),
 entry('Same date','todo',{start:new Date('2026-10-12T00:00:00Z')})];
 const groups=groupEntriesByDate(entries,metadata);
 assert.deepEqual(groups[0].entries.map(entry=>entry.id),['First','Deadline only','Same date','Last']);
 assert.deepEqual(entries.map(entry=>entry.id),['Last','Deadline only','First','Same date']);
});
test('invalid dates are undated unless the other valid date is present',()=>{
 const invalid=entry('Invalid','todo',{start:'2026-02-30',deadline:''});
 const fallback=entry('Fallback','todo',{start:'invalid',deadline:'2026-10-05'});
 const groups=groupEntriesByDate([invalid,fallback],metadata);
 assert.deepEqual(groups[0].entries,[invalid]);assert.deepEqual(groups[1].entries,[fallback]);
});
test('empty groups are omitted and each entry appears once',()=>{
 assert.deepEqual(groupEntriesByDate([],metadata),[]);
 const entries=[entry('Someday','someday'),entry('Other someday','someday',{deadline:'2026-12-01'})];
 const groups=groupEntriesByDate(entries,metadata);
 assert.deepEqual(groups.map(group=>group.label),['Someday']);
 assert.deepEqual(groups.flatMap(group=>group.entries),entries);
});

function project(id, dates = {}, relations = {}, status = 'todo') {
 return { ...entry(id, status, dates), file: { path: `${id}.md` }, text: id, ...relations };
}
const reference = item => ({ path: item.file.path, name: item.text, icon: 'circle-small' });
// Follow the list's group policy so an accidentally flattened section loses these connectors.
function groupedTrees(entries) {
 return groupEntriesByDate(entries, metadata).map(group => ({
  label: group.label,
  nodes: group.nest ? nestTaggedEntries(group.entries) : group.entries.map(entry => ({ entry, children: [] })),
 }));
}
function flatten(nodes, depth = 0) {
 return nodes.flatMap(node => [[node.entry.id, depth], ...flatten(node.children, depth + 1)]);
}

test('upcoming nests children and dependencies together, preserving root and sibling date order', () => {
 const early = project('Early', { start: '2026-10-02' });
 const parent = project('Parent', { start: '2026-10-20' });
 const child = project('Child', { start: '2026-10-05' }, { parents: [reference(parent)] });
 const sibling = project('Sibling', { deadline: '2026-10-09' }, { parents: [reference(parent)] });
 const dependent = project('Dependent', { start: '2026-10-06' }, { dependents: [reference(child)] });
 const late = project('Late', { start: '2026-10-25' });
 const entries = [late, sibling, dependent, parent, child, early];
 const before = structuredClone(entries);
 const [{ label, nodes }] = groupedTrees(entries);
 assert.equal(label, 'Upcoming');
 assert.deepEqual(flatten(nodes), [['Early', 0], ['Parent', 0], ['Child', 1], ['Dependent', 2], ['Sibling', 1], ['Late', 0]]);
 const childNode = nodes[1].children[0];
 assert.equal(childNode.relationship, 'parent');
 assert.equal(childNode.children[0].relationship, 'dependent');
 assert.deepEqual(visibleEntryRelations(childNode), []);
 assert.deepEqual(visibleEntryRelations(childNode.children[0]), []);
 assert.deepEqual(entries, before);
});

test('upcoming inline entries nest under their source with exact navigation identity', () => {
 const source = project('Source', { start: '2026-10-08' });
 const inline = { ...project('Inline', { start: source.start }), file: source.file,
  line: 7, sourceLine: '- Inline #project', subtitle: source.text };
 const [{ nodes }] = groupedTrees([inline, source]);
 assert.deepEqual(flatten(nodes), [['Source', 0], ['Inline', 1]]);
 assert.equal(nodes[0].children[0].relationship, 'parent');
 assert.equal(nodes[0].children[0].entry.line, 7);
 assert.equal(nodes[0].children[0].entry.sourceLine, '- Inline #project');
 assert.deepEqual(visibleEntryRelations(nodes[0].children[0]), []);
});

test('relationships never move projects between sections and outside links stay in subtitles', () => {
 const undated = project('Undated');
 const someday = project('Someday', { start: '2026-10-01' }, {}, 'someday');
 const child = project('Child', { start: '2026-10-08' }, { parents: [reference(undated)] });
 const dependent = project('Dependent', { start: '2026-10-09' }, { dependents: [reference(someday)] });
 const groups = groupedTrees([someday, dependent, child, undated]);
 assert.deepEqual(groups.map(group => group.label), [undefined, 'Upcoming', 'Someday']);
 assert.deepEqual(groups.map(group => flatten(group.nodes)), [[['Undated', 0]], [['Child', 0], ['Dependent', 0]], [['Someday', 0]]]);
 assert.deepEqual(visibleEntryRelations(groups[1].nodes[0]), child.parents);
 assert.deepEqual(visibleEntryRelations(groups[1].nodes[1]), dependent.dependents);
});

test('same-section cycles keep every project visible once', () => {
 const a = project('A', { start: '2026-10-08' });
 const b = project('B', { start: '2026-10-09' }, { dependents: [reference(a)] });
 a.parents = [reference(b)];
 const [{ nodes }] = groupedTrees([b, a]);
 const rows = flatten(nodes);
 assert.equal(rows.length, 2);
 assert.deepEqual(new Set(rows.map(([id]) => id)), new Set(['A', 'B']));
});
