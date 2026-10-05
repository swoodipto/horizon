import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
const code=buildSync({entryPoints:[fileURLToPath(new URL('../src/ui/note-action-history.ts',import.meta.url))],bundle:true,write:false,format:'esm'}).outputFiles[0].text;
const {NoteActionHistory}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
function fixture(){
 const a={path:'a.md',basename:'a',properties:{tags:['project','doing'],parent:'[[Old]]',other:42},content:'- First #project #doing\r\n- Second #project #waiting\r\nKeep this'};
 const b={path:'b.md',basename:'b',properties:{tags:['project','waiting'],other:17},content:'Unrelated'};
 const files=[a,b];
 const app={vault:{getFileByPath:path=>files.find(file=>file.path===path),process:async(file,fn)=>file.content=fn(file.content)},
 fileManager:{processFrontMatter:async(file,fn)=>{const next=structuredClone(file.properties);fn(next);file.properties=next;}},metadataCache:{}};
 const history=new NoteActionHistory(app);return{a,b,files,app,history};
}
test('a multi-note action undoes/redoes as one step, restoring absence and preserving unrelated edits',async()=>{
 const {a,b,history}=fixture();
 await history.record(async app=>{for(const file of[a,b]) await app.fileManager.processFrontMatter(file,p=>{p.deadline='2026-11-01';});});
 a.properties.other=99;
 assert.equal(await history.undo(),true);assert.equal('deadline'in a.properties,false);assert.equal('deadline'in b.properties,false);assert.equal(a.properties.other,99);
 assert.equal(await history.undo(),false);await history.redo();assert.equal(a.properties.deadline,'2026-11-01');assert.equal(b.properties.deadline,'2026-11-01');assert.equal(await history.redo(),false);
});
test('mixed whole-note and inline actions restore only changed lines, keeping CRLF and later unrelated edits',async()=>{
 const {a,b,history}=fixture();
 await history.record(async app=>{
  await app.fileManager.processFrontMatter(a,p=>{p.tags=['project','ready'];});
  await app.vault.process(a,text=>text.replace('#doing','#ready'));
  await app.fileManager.processFrontMatter(b,p=>{p.tags=['project','ready'];});
 });
 a.content='Inserted\r\n'+a.content.replace('Keep this','Keep newer text');
 await history.undo();assert.deepEqual(a.properties.tags,['project','doing']);assert.deepEqual(b.properties.tags,['project','waiting']);
 assert.equal(a.content,'Inserted\r\n- First #project #doing\r\n- Second #project #waiting\r\nKeep newer text');
 await history.redo();assert.ok(a.content.includes('First #project #ready'));assert.ok(a.content.endsWith('Keep newer text'));
});
test('changed owned properties reject undo without overwriting newer data and remain retryable',async()=>{
 const {a,history}=fixture();await history.record(app=>app.fileManager.processFrontMatter(a,p=>{p.parent=['[[New]]'];}));
 a.properties.parent=['[[External]]'];await assert.rejects(history.undo(),/parent changed/);assert.deepEqual(a.properties.parent,['[[External]]']);
 a.properties.parent=['[[New]]'];await history.undo();assert.equal(a.properties.parent,'[[Old]]');await history.redo();assert.deepEqual(a.properties.parent,['[[New]]']);
});
test('edited, ambiguous and missing inline sources reject replay instead of restoring whole note text',async()=>{
 const {a,history,files}=fixture();await history.record(app=>app.vault.process(a,t=>t.replace('#doing','#ready')).then(()=>{}));
 a.content='Changed\n- First #project #ready\n- First #project #ready';await assert.rejects(history.undo(),/ambiguous/);
 a.content='Changed';await assert.rejects(history.undo(),/source line changed/);
 files.splice(0,1);await assert.rejects(history.undo(),/no longer exists/);
});
test('new actions clear redo, no-ops retain redo and history retains the latest 50 actions',async()=>{
 const {a,history}=fixture();const write=value=>history.record(app=>app.fileManager.processFrontMatter(a,p=>{p.deadline=value;}));
 await write('2026-11-01');await history.undo();await history.record(async()=>{});assert.equal(await history.redo(),true);
 await history.undo();await write('2026-12-01');assert.equal(await history.redo(),false);
 for(let i=0;i<55;i++)await history.record(app=>app.fileManager.processFrontMatter(a,p=>{p.tags=['project',String(i)];}));
 let count=0;while(await history.undo())count++;assert.equal(count,50);
 history.clear();assert.equal(await history.redo(),false);
});
test('partial action successes remain undoable and partial replay reports its progress',async()=>{
 const {a,b,history}=fixture();
 await assert.rejects(history.record(async app=>{await app.fileManager.processFrontMatter(a,p=>{p.tags=['project','ready'];});await app.fileManager.processFrontMatter(b,p=>{p.tags=['project','ready'];});throw new Error('Third item failed.');}),/Third item/);
 a.properties.tags=['project','external'];await assert.rejects(history.undo(),/after 1 of 2/);assert.deepEqual(b.properties.tags,['project','waiting']);
 await history.redo();assert.deepEqual(b.properties.tags,['project','ready']);assert.deepEqual(a.properties.tags,['project','external']);
});
test('date replay revalidates against the other endpoint and busy writes reject concurrent replay',async()=>{
 const {a,history}=fixture();a.properties['start date']='2026-10-01';a.properties.deadline='2026-10-10';
 await history.record(app=>app.fileManager.processFrontMatter(a,p=>{p.deadline='2026-10-20';}));a.properties['start date']='2026-10-15';
 await assert.rejects(history.undo(),/deadline cannot be before/);assert.equal(a.properties.deadline,'2026-10-20');
 let release;const pending=history.record(()=>new Promise(resolve=>{release=resolve;}));await assert.rejects(history.undo(),/Wait/);release();await pending;
});
test('closing history during an in-flight write does not repopulate the cleared undo stack',async()=>{
 const {a,history}=fixture();let release;
 const pending=history.record(async app=>{await new Promise(resolve=>{release=resolve;});await app.fileManager.processFrontMatter(a,p=>{p.tags=['project','ready'];});});
 history.clear();release();await pending;assert.equal(await history.undo(),false);
});
