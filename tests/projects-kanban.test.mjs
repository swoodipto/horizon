import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
async function load(name) {
 const result = await build({entryPoints:[fileURLToPath(new URL(`../src/ui/${name}.ts`,import.meta.url))],bundle:true,write:false,format:'esm',
 plugins:[{name:'obsidian',setup(build){build.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export class Component {} export class Notice {} export function setIcon() {} export function parseFrontMatterTags(p){return (Array.isArray(p.tags)?p.tags:typeof p.tags==='string'?p.tags.split(/[\\s,]+/):[]).map(t=>'#'+t.replace(/^#/,''));}`}));}}]});
 const code = result.outputFiles[0].text;
 return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const dates=await load('inline-project-dates'), adapter=await load('entry-dates'), model=await load('project-board-model');
const blocks=await load('project-block'), transfer=await load('project-transfer'), moves=await load('project-board-move');
const {NoteActionHistory}=await load('note-action-history'), {setLineStatus}=await load('project-status');
const {ProjectBoard}=await load('project-board');
const {findTaggedEntries}=await load('tagged-notes');
const dateLine='- Build #project [start date:: 2026-10-09] [deadline:: 2026-10-31]';
const pos=(start,end=start,col=50)=>({start:{line:start,col:0},end:{line:end,col}});
const file=(path,properties={},content='')=>({path,basename:path.replace(/\.md$/,''),properties,content});
function fixture(files){
 const app={vault:{getFileByPath:path=>files.find(f=>f.path===path),read:async f=>f.content,process:async(f,apply)=>f.content=apply(f.content)},
 fileManager:{processFrontMatter:async(f,apply)=>{const next=structuredClone(f.properties);apply(next);f.properties=next;},generateMarkdownLink:(f,source,subpath,label)=>`[[${f.basename}${subpath}|${label}]]`},
 metadataCache:{getFileCache:f=>({frontmatter:f.properties,...f.cache}),getFirstLinkpathDest:path=>files.find(f=>f.path===path||f.basename===path)}};
 return {app,history:new NoteActionHistory(app)};
}
test('inline dates use independent civil fields, excluding code, comments, escaped fields and link labels',()=>{
 assert.equal(dates.inlineProjectDates(dateLine).start,'2026-10-09');
 assert.equal(dates.inlineProjectDates('[ START   DATE :: 2026-10-09 ]').start,'2026-10-09');
 for(const literal of ['`[deadline:: 2026-10-31]`','<!-- [deadline:: 2026-10-31] -->','%% [deadline:: 2026-10-31] %%','\\[deadline:: 2026-10-31]','[[deadline:: 2026-10-31]]','[label [deadline:: 2026-10-31]](target)','[deadline:: 2026-10-31](target)']) assert.equal(dates.inlineProjectDates(literal).deadline,undefined,literal);
 assert.equal(adapter.entryDates({line:0,sourceLine:'- Build #project'},{'start date':'2026-10-09',deadline:'2026-10-31'}).start,undefined);
 assert.equal(adapter.entryDates({}, {'start date':'2026-10-09'}).start,'2026-10-09');
});
test('invalid, repeated and reversed inline fields report issues',()=>{
 for(const line of ['[deadline:: 2026-02-30]','[deadline:: ]','[deadline:: 2026-10-01] [deadline:: 2026-10-02]','[start date:: 2026-11-01] [deadline:: 2026-10-31]']) assert.ok(dates.inlineProjectDates(line).issue);
});
test('inline date writes preserve CRLF, indentation, anchors, trailing spaces and unrelated content',()=>{
 const raw='  - [ ] Build #project ^build  ';
 const next=dates.setInlineProjectDate('Intro\r\n'+raw+'\r\nKeep',{line:1,sourceLine:raw},'start','2026-10-09');
 assert.equal(next,'Intro\r\n  - [ ] Build #project [start date:: 2026-10-09] ^build  \r\nKeep');
 const line=next.split('\r\n')[1];
 assert.equal(dates.setInlineProjectDate(next,{line:1,sourceLine:line},'start',''),'Intro\r\n'+raw+'\r\nKeep');
 assert.equal(setLineStatus(raw,{line:0,sourceLine:raw},'doing'),'  - [ ] Build #project #doing ^build  ');
});
test('inline writes relocate unique lines and refuse ambiguous, stale, invalid or conflicting endpoints',()=>{
 assert.ok(dates.setInlineProjectDate('Intro\n'+dateLine,{line:0,sourceLine:dateLine},'deadline','2026-11-01').includes('2026-11-01'));
 for(const content of ['Changed', 'Intro\n'+dateLine+'\n'+dateLine]) assert.throws(()=>dates.setInlineProjectDate(content,{line:0,sourceLine:dateLine},'deadline','2026-11-01'),/changed|ambiguous/);
 assert.throws(()=>dates.setInlineProjectDate(dateLine,{line:0,sourceLine:dateLine},'deadline','2026-10-08'),/before/);
 const repeated='- X #project [deadline:: 2026-10-10] [deadline:: 2026-10-11]';
 assert.throws(()=>dates.setInlineProjectDate(repeated,{line:0,sourceLine:repeated},'deadline',''),/Repeated/);
});
test('project discovery cleans date fields and waits for current cached tag positions',async()=>{
 const f=file('A.md',{},dateLine), col=dateLine.indexOf('#project');
 const meta={noteTags:[],lineTags:[{tag:'#project',position:{start:{line:0,col},end:{line:0,col:col+8}}}]};
 const [entry]=await findTaggedEntries([f],()=>meta,async()=>dateLine,'#project');
 assert.equal(entry.text,'Build'); assert.equal(entry.sourceLine,dateLine);
 assert.deepEqual(await findTaggedEntries([f],()=>meta,async()=>'Added '+dateLine,'#project'),[]);
});
test('board has eight ordered columns, global empty hiding, every-parent occurrences and one flat card',()=>{
 const a=file('A.md'), b=file('B.md'), p={file:file('P.md'),text:'Project',parents:[{path:a.path,name:'A',icon:'file'},{path:b.path,name:'B',icon:'file'}]};
 const retained=new Map(), prefs={mode:'kanban',swimlanes:true,hideEmpty:false};
 const board=model.projectBoard([p],()=> 'doing',prefs,retained);
 assert.equal(board.statuses.length,8); assert.equal(board.cards.length,2); assert.equal(board.cards[0].entry,board.cards[1].entry);
 assert.equal(model.projectBoard([p],()=> 'doing',{...prefs,swimlanes:false},retained).cards.length,1);
 assert.deepEqual(model.projectBoard([p],()=> 'doing',{...prefs,hideEmpty:true},retained).statuses.map(s=>s.tag),['doing']);
 assert.ok(model.projectBoard([],()=> 'todo',prefs,retained).lanes.some(l=>l.path==='A.md'));
 const inline={file:a,text:'Inline',line:0,sourceLine:'Inline #project'};
 assert.equal(model.projectBoard([inline],()=> 'todo',prefs,new Map()).cards[0].lane.path,'A.md');
});
test('partial view state retains board preferences and alphabetical cards',()=>{
 const prefs={mode:'kanban',swimlanes:true,hideEmpty:true}; assert.deepEqual(model.boardPreferences({},prefs),prefs);
 assert.deepEqual(model.boardPreferences({mode:'invalid',hideEmpty:false},prefs),{...prefs,hideEmpty:false});
 const entries=['Zulu','Alpha'].map(text=>({file:file(text+'.md'),text}));
 assert.deepEqual(model.projectBoard(entries,()=> 'todo',prefs,new Map()).cards.map(c=>c.entry.text),['Alpha','Zulu']);
});
test('releasing a card without dragging preserves it for the following click',async()=>{
 const board=Object.create(ProjectBoard.prototype); let refreshes=0;
 board.enabled=()=>true; board.refresh=async()=>{refreshes++}; board.cleanGesture=()=>{board.gesture=undefined};
 board.gesture={pointer:1,started:false};
 await board.finish({pointerId:1});
 assert.equal(refreshes,0); assert.equal(board.gesture,undefined);
 board.gesture={pointer:2,started:true};
 await board.finish({pointerId:2});
 assert.equal(refreshes,1);
});
test('cached list subtree includes non-task content and heading boundary excludes the next peer',()=>{
 const raw='  - Build #project\n    continuation\n    - [x] Child\n      code\n- Sibling #project';
 const cache={listItems:[{parent:-1,position:pos(0,3)},{parent:0,position:pos(2,3)}]};
 const block=blocks.projectBlock(raw,{line:0,sourceLine:raw.split('\n')[0]},cache);
 assert.equal(block.end,3);assert.equal(blocks.topLevelBlock(block),'- Build #project\n  continuation\n  - [x] Child\n    code');
 const heading='# Build #project\nText\n## Child\nMore\n# Peer';
 assert.equal(blocks.projectBlock(heading,{line:0,sourceLine:'# Build #project'},{headings:[{level:1,position:pos(0)},{level:2,position:pos(2)},{level:1,position:pos(4)}]}).end,3);
});
test('paragraph/quote boundaries and malformed Markdown fail safely',()=>{
 const content='First\nBody #project\n\nOther';
 assert.equal(blocks.projectBlock(content,{line:1,sourceLine:'Body #project'},{sections:[{type:'paragraph',position:pos(0,1)}]}).text,'First\nBody #project');
 for(const text of ['```js\ncode','%%\nHidden','<!-- hidden']) assert.equal(blocks.safeMarkdownEnd(text),false);
 assert.equal(blocks.safeMarkdownEnd('```js\ncode\n```\n\nVisible'),true);
 assert.equal(blocks.safeMarkdownEnd('```html\n<!-- %%\n```\n\nVisible'),true);
 assert.throws(()=>blocks.projectBlock(content,{line:0,sourceLine:'First'},null),/metadata/);
});
test('whole-note cross-lane move replaces only origin, deduplicates existing destination and undoes once',async()=>{
 const a=file('A.md'),b=file('B.md'),c=file('C.md'),p=file('P.md',{tags:['project','doing','client'],parent:['[[A]]','[[B]]'],dependent:'[[Keep]]'});
 const {app,history}=fixture([a,b,c,p]);
 const card={entry:{file:p,text:'P'},status:'doing',lane:{id:a.path,path:a.path,name:'A'}};
 await moves.applyBoardMove(app,history,await moves.prepareBoardMove(app,card),{id:c.path,path:c.path,name:'C'},'ready');
 assert.deepEqual(p.properties.parent,['[[B]]','[[C]]']);assert.deepEqual(p.properties.tags,['project','client','ready']);assert.equal(p.properties.dependent,'[[Keep]]');
 await history.undo();assert.deepEqual(p.properties.parent,['[[A]]','[[B]]']);assert.deepEqual(p.properties.tags,['project','doing','client']);
 await moves.applyBoardMove(app,history,await moves.prepareBoardMove(app,card),{id:b.path,path:b.path,name:'B'},'doing');assert.deepEqual(p.properties.parent,['[[B]]']);
});
test('No parent clears every parent; stale and cyclic parent drops do not write',async()=>{
 const a=file('A.md'),p=file('P.md',{tags:['project'],parent:['[[A]]']}),child=file('Child.md',{parent:'[[P]]'});
 const {app,history}=fixture([a,p,child]);const card={entry:{file:p,text:'P'},status:'todo',lane:{id:a.path,path:a.path,name:'A'}};
 const prepared=await moves.prepareBoardMove(app,card);
 await assert.rejects(moves.applyBoardMove(app,history,prepared,{id:child.path,path:child.path,name:'Child'},'doing'),/cycle/);
 p.properties.parent=['[[External]]'];await assert.rejects(moves.applyBoardMove(app,history,prepared,{id:model.NO_PARENT,name:'No parent'},'todo'),/changed/);
 p.properties.parent=['[[A]]'];await moves.applyBoardMove(app,history,prepared,{id:model.NO_PARENT,name:'No parent'},'todo');assert.equal('parent'in p.properties,false);
});
test('inline cross-note move preserves complete block and dates, changes root status only, leaves link and replays safely',async()=>{
 const raw='- [ ] Build #project #doing [deadline:: 2026-10-31]\n  - Nested #project #waiting\n    - [x] Task\n- Sibling';
 const a=file('A.md',{},raw),b=file('B.md',{},'Destination');a.cache={listItems:[{parent:-1,position:pos(0,2)},{parent:0,position:pos(1,2)},{parent:1,position:pos(2)}]};
 const {app,history}=fixture([a,b]);const card={entry:{file:a,text:'Build',line:0,sourceLine:raw.split('\n')[0]},status:'doing',lane:{id:a.path,path:a.path,name:'A'}};
 await moves.applyBoardMove(app,history,await moves.prepareBoardMove(app,card),{id:b.path,path:b.path,name:'B'},'ready');
 assert.match(a.content,/^- \[\[B#\^horizon-/); assert.ok(a.content.endsWith('\n- Sibling'));assert.ok(!a.content.includes('#project'));
 assert.match(b.content,/- \[ \] Build #project \[deadline:: 2026-10-31\] #ready \^horizon-/);assert.ok(b.content.includes('Nested #project #waiting'));assert.ok(b.content.includes('- [x] Task'));
 b.content='New unrelated text\n'+b.content;
 await history.undo();assert.equal(a.content,raw);assert.equal(b.content,'New unrelated text\nDestination');
 await history.redo();assert.ok(b.content.includes('#ready'));assert.equal(await history.redo(),false);
});
test('transfer failure compensates only untouched insertion, preserving newer destination edits',async()=>{
 const a=file('A.md',{},'Block'),b=file('B.md',{},'End');const {app}=fixture([a,b]);
 const source={path:a.path,before:'Block',after:'Forward',index:0},destination={path:b.path,before:'',after:'\nMoved',index:3,prefix:'End'};
 const process=app.vault.process;
 app.vault.process=async(f,apply)=>{if(f===a)throw new Error('Source failed');return process(f,apply);};
 await assert.rejects(transfer.moveProjectBlock(app,source,destination),/Source failed/);assert.equal(a.content,'Block');assert.equal(b.content,'End');
 app.vault.process=async(f,apply)=>{if(f===a){b.content=b.content.replace('Moved','Edited moved');throw new Error('Source failed');}return process(f,apply);};
 await assert.rejects(transfer.moveProjectBlock(app,source,destination),/copy remains/);assert.equal(a.content,'Block');assert.equal(b.content,'End\nEdited moved');
});
test('undo refuses edited transferred content before touching either note',async()=>{
 const a=file('A.md',{},'Block'),b=file('B.md',{},'End');const {app,history}=fixture([a,b]);
 await history.recordTransfer(()=>transfer.moveProjectBlock(app,{path:a.path,before:'Block',after:'Forward',index:0},{path:b.path,before:'',after:'\nMoved',index:3,prefix:'End'}));
 b.content='End\nEdited';await assert.rejects(history.undo(),/changed|ambiguous/);assert.equal(b.content,'End\nEdited');assert.equal(a.content,'Forward');
});
test('entry fields preserve closing table and heading delimiters',()=>{
 for(const raw of ['| Build #project |','## Build #project ##']) {
  const target={path:'A.md',line:0,sourceLine:raw};
  const delimiter=raw.startsWith('|')?' |':' ##';
  assert.equal(setLineStatus(raw,target,'ready'),raw.slice(0,-delimiter.length)+' #ready'+delimiter);
  assert.equal(dates.setInlineProjectDate(raw,target,'start','2026-10-09'),raw.slice(0,-delimiter.length)+' [start date:: 2026-10-09]'+delimiter);
 }
});
test('heading transfer keeps its full section and descendant statuses',async()=>{
 const raw='# Build #project #doing ^root\nIntro\n## Nested #project #waiting\nBody\n# Peer';
 const a=file('A.md',{},raw),b=file('B.md');a.cache={headings:[{level:1,position:pos(0)},{level:2,position:pos(2)},{level:1,position:pos(4)}]};
 const {app,history}=fixture([a,b]);const card={entry:{file:a,text:'Build',line:0,sourceLine:raw.split('\n')[0]},status:'doing',lane:{id:a.path,path:a.path,name:'A'}};
 await moves.applyBoardMove(app,history,await moves.prepareBoardMove(app,card),{id:b.path,path:b.path,name:'B'},'ready');
 assert.equal(a.content,'# [[B#^root|Build]] ^root\n# Peer');
 assert.equal(b.content,'# Build #project #ready ^root\nIntro\n## Nested #project #waiting\nBody\n');
 await history.undo();assert.equal(a.content,raw);assert.equal(b.content,'');
});
test('paragraph transfers anchor the complete paragraph, including a project on an interior line',async()=>{
 for(const anchor of ['', ' ^existing']) {
  const raw='Opening\nBuild #project\nTail'+anchor+'\n\nKeep';
  const a=file('A.md',{},raw),b=file('B.md');a.cache={sections:[{type:'paragraph',position:pos(0,2)}]};
  const {app,history}=fixture([a,b]);const card={entry:{file:a,text:'Build',line:1,sourceLine:'Build #project'},status:'todo',lane:{id:a.path,path:a.path,name:'A'}};
  await moves.applyBoardMove(app,history,await moves.prepareBoardMove(app,card),{id:b.path,path:b.path,name:'B'},'ready');
  assert.match(b.content,/^Opening\nBuild #project #ready\nTail \^(?:horizon-[a-f0-9-]+|existing)\n$/);
  if(anchor) assert.ok(a.content.startsWith('[[B#^existing|Build]] ^existing'));
  assert.ok(a.content.endsWith('\n\nKeep'));await history.undo();assert.equal(a.content,raw);
 }
});
test('quote and table transfers use standalone anchors and preserve existing block anchors',async()=>{
 for(const example of [
  {raw:'> [!note]\n> Build #project\n> Tail',type:'blockquote',line:1},
  {raw:'| Name |\n| --- |\n| Build #project |',type:'table',line:2},
  {raw:'> [!note]\n> Build #project\n> Tail\n\n^quote-id',type:'blockquote',line:1},
 ]) {
  const a=file('A.md',{},example.raw+'\n\nKeep'),b=file('B.md');a.cache={sections:[{type:example.type,position:pos(0,2)}]};
  const {app,history}=fixture([a,b]);const card={entry:{file:a,text:'Build',line:example.line,sourceLine:example.raw.split('\n')[example.line]},status:'todo',lane:{id:a.path,path:a.path,name:'A'}};
  await moves.applyBoardMove(app,history,await moves.prepareBoardMove(app,card),{id:b.path,path:b.path,name:'B'},'ready');
  assert.match(b.content,/\n\n\^(?:horizon-[a-f0-9-]+|quote-id)\n$/);
  if(example.type==='table')assert.ok(b.content.includes('| Build #project #ready |'));
  if(example.raw.includes('^quote-id'))assert.equal(b.content.match(/\^quote-id/g).length,1);
  assert.ok(a.content.endsWith('\n\nKeep'));await history.undo();assert.equal(a.content,example.raw+'\n\nKeep');
 }
});
test('stale nested content and colliding destination anchors reject before either note changes',async()=>{
 const raw='- Build #project ^root\n  - [ ] Child';
 const a=file('A.md',{},raw),b=file('B.md',{},'Existing ^root');a.cache={listItems:[{parent:-1,position:pos(0,1)},{parent:0,position:pos(1)}]};
 const {app,history}=fixture([a,b]);const card={entry:{file:a,text:'Build',line:0,sourceLine:raw.split('\n')[0]},status:'todo',lane:{id:a.path,path:a.path,name:'A'}};
 const prepared=await moves.prepareBoardMove(app,card),lane={id:b.path,path:b.path,name:'B'};
 await assert.rejects(moves.applyBoardMove(app,history,prepared,lane,'doing'),/identifier/);assert.equal(a.content,raw);assert.equal(b.content,'Existing ^root');
 b.content='Destination';a.content=raw.replace('[ ]','[x]');
 await assert.rejects(moves.applyBoardMove(app,history,prepared,lane,'doing'),/changed/);assert.equal(a.content,raw.replace('[ ]','[x]'));assert.equal(b.content,'Destination');
});
test('overlapping transfers are serialized across histories and release their locks',async()=>{
 const a=file('A.md',{},'Block'),b=file('B.md',{},'End');const {app}=fixture([a,b]);
 const source={path:a.path,before:'Block',after:'Forward',index:0},destination={path:b.path,before:'',after:'\nMoved',index:3,prefix:'End'};
 const process=app.vault.process;let resume,started;
 const entered=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>resume=resolve);
 app.vault.process=async(f,apply)=>{if(f===b){started();await gate;}return process(f,apply);};
 const pending=transfer.moveProjectBlock(app,source,destination);await entered;
 await assert.rejects(transfer.moveProjectBlock(app,source,destination),/current move/);assert.equal(a.content,'Block');assert.equal(b.content,'End');
 resume();const action=await pending;await action.undo();assert.equal(a.content,'Block');assert.equal(b.content,'End');
});
test('mixed whole-note and inline date changes in one file remain distinct through YAML line shifts and undo',async()=>{
 const raw='- First #project\n- Second #project';const a=file('A.md',{tags:['project'],client:'Keep'},raw);
 const {app,history}=fixture([a]);const process=app.fileManager.processFrontMatter;
 app.fileManager.processFrontMatter=async(f,apply)=>{
  const body=f.content.replace(/^---\n[^\n]*\n---\n/,'');
  await process(f,apply);f.content='---\n'+JSON.stringify(f.properties)+'\n---\n'+body;
 };
 const targets=[{path:a.path},{path:a.path,line:0,sourceLine:'- First #project'},{path:a.path,line:1,sourceLine:'- Second #project'}];
 await history.record(async tracked=>{for(const target of targets)await adapter.setEntryDate(tracked,target,'deadline','2026-10-31');});
 assert.equal(a.properties.deadline,'2026-10-31');assert.equal(a.properties.client,'Keep');
 assert.ok(a.content.endsWith('- First #project [deadline:: 2026-10-31]\n- Second #project [deadline:: 2026-10-31]'));
 await history.undo();assert.equal(a.properties.deadline,undefined);assert.ok(a.content.endsWith(raw));
 await history.redo();assert.equal(a.properties.deadline,'2026-10-31');assert.equal(a.content.match(/\[deadline::/g).length,2);
});
