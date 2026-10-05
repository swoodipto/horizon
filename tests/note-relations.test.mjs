import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
const code=buildSync({entryPoints:[fileURLToPath(new URL('../src/ui/note-relations.ts',import.meta.url))],bundle:true,write:false,format:'esm'}).outputFiles[0].text;
const { relationValues, addNoteRelation }=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
function fixture(properties={}) {
 const files=[{path:'Plan.md'},{path:'Work.md'},{path:'Other.md'}];
 return {properties,app:{vault:{getFileByPath:path=>files.find(file=>file.path===path)},
 metadataCache:{getFirstLinkpathDest:path=>files.find(file=>file.path===path || file.path===path+'.md')},
 fileManager:{processFrontMatter:async(file,fn)=>fn(properties)}}};
}
test('relation values handle absent, plain, aliased and multiple note links',()=>{
 assert.deepEqual(relationValues(undefined),[]);
 assert.deepEqual(relationValues('Work'),['Work']);
 assert.deepEqual(relationValues('[[Work|Label]] [[Other]]'),['[[Work|Label]]','[[Other]]']);
 assert.throws(()=>relationValues([42]),/note links/);
});
test('selecting a parent preserves unresolved existing links and unrelated properties',async()=>{
 const {app,properties}=fixture({parent:['[[Missing]]'],dependent:'[[Other]]',tags:['project'],start:'2026-10-01'});
 await addNoteRelation(app,'Plan.md','parent','Work.md');
 assert.deepEqual(properties,{parent:['[[Missing]]','[[Work]]'],dependent:'[[Other]]',tags:['project'],start:'2026-10-01'});
});
test('selecting dependent preserves parent and does not duplicate resolved aliases',async()=>{
 const {app,properties}=fixture({dependent:'[[Work|Custom]]',parent:'[[Other]]'});
 await addNoteRelation(app,'Plan.md','dependent','Work.md');
 assert.equal(properties.dependent,'[[Work|Custom]]');
 await addNoteRelation(app,'Plan.md','dependent','Other.md');
 assert.deepEqual(properties.dependent,['[[Work|Custom]]','[[Other]]']);
 assert.equal(properties.parent,'[[Other]]');
});
test('deleted notes, self links and malformed properties are not written',async()=>{
 const {app,properties}=fixture({parent:123});
 await assert.rejects(addNoteRelation(app,'Plan.md','parent','Missing.md'),/no longer exists/);
 await assert.rejects(addNoteRelation(app,'Plan.md','parent','Plan.md'),/different note/);
 await assert.rejects(addNoteRelation(app,'Plan.md','parent','Work.md'),/note links/);
 assert.equal(properties.parent,123);
});
