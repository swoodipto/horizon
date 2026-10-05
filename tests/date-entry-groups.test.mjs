import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
const code=buildSync({entryPoints:[fileURLToPath(new URL('../src/ui/date-entry-groups.ts',import.meta.url))],bundle:true,write:false,format:'esm'}).outputFiles[0].text;
const {groupEntriesByDate}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const metadata=entry=>entry;
const entry=(id,status='todo',dates={})=>({id,status,...dates});
test('undated entries are first without heading and someday is always last',()=>{
 const undated=entry('Undated','doing');
 const someday=entry('Someday','someday',{start:'2026-10-01'});
 const dated=entry('Dated','waiting',{start:'2026-10-12'});
 const groups=groupEntriesByDate([someday,dated,undated],metadata);
 assert.deepEqual(groups.map(group=>group.label),[undefined,'Upcoming','Someday']);
 assert.deepEqual(groups.map(group=>group.entries),[[undated],[dated],[someday]]);
 assert.equal(groups[1].nest,false);
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
