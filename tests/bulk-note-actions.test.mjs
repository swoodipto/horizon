import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
const code=buildSync({entryPoints:[fileURLToPath(new URL('../src/ui/bulk-note-actions.ts',import.meta.url))],bundle:true,write:false,format:'esm'}).outputFiles[0].text;
const {applyToItems}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('bulk actions complete sequentially for entries sharing a source note',async()=>{
 const completed=[];let active=false;
 await applyToItems([1,2,3],async item=>{assert.equal(active,false);active=true;await Promise.resolve();completed.push(item);active=false;});
 assert.deepEqual(completed,[1,2,3]);
});
test('partial failures do not prevent remaining selected entries from updating and are reported',async()=>{
 const completed=[];
 await assert.rejects(applyToItems([1,2,3],async item=>{if(item===2)throw new Error('Source changed.');completed.push(item);}),/2 of 3 updated. 1 failed: Source changed/);
 assert.deepEqual(completed,[1,3]);
});
