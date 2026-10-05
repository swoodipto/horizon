import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
const code=buildSync({entryPoints:[fileURLToPath(new URL('../src/ui/parent-entry-groups.ts',import.meta.url))],bundle:true,write:false,format:'esm'}).outputFiles[0].text;
const {groupEntriesByParent}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const parent=(name,path)=>({name,path,icon:'sticky-note'});
test('parent groups preserve entry order and put unparented entries first',()=>{
 const a={id:'a',parents:[parent('Work','Work.md')]};
 const b={id:'b',parents:[]};
 const c={id:'c',parents:[parent('Health','Health.md')]};
 const d={id:'d',parents:[parent('Work alias','Work.md')]};
 const groups=groupEntriesByParent([a,b,c,d],entry=>entry.parents);
 assert.deepEqual(groups.map(group=>group.entries),[[b],[a,d],[c]]);
 assert.deepEqual(groups.map(group=>group.parent?.name),[undefined,'Work','Health']);
});
test('first parent prevents duplicates and equal names with different paths stay separate',()=>{
 const entries=[{parents:[parent('Same','A/Same.md'),parent('Other','Other.md')]},
 {parents:[parent('Same','B/Same.md')]},{parents:[parent('Missing')]}];
 const groups=groupEntriesByParent(entries,entry=>entry.parents);
 assert.equal(groups.length,3);assert.deepEqual(groups.flatMap(group=>group.entries),entries);
 assert.deepEqual(groupEntriesByParent([],()=>[]),[]);
});
