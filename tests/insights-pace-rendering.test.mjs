import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: {
	contents: "export { PaceGraph } from './src/insights/pace-graph'; export { PaceCard } from './src/insights/pace-card';",
	resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
}, bundle: true, write: false, format: 'esm', plugins: [{
	name: 'obsidian', setup(builder) {
		builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'mock', namespace: 'test' }));
		builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ loader: 'js', contents: `export class Component {
			cleanups = []; register(fn) { this.cleanups.push(fn); }
			addChild(child) { this.register(() => child.unload()); return child; }
			registerDomEvent(el,name,fn) { el.listeners.set(name,fn); this.register(() => el.listeners.delete(name)); }
			unload() { for(const fn of this.cleanups)fn(); }
		}` }));
	},
}] });
const { PaceGraph, PaceCard } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const math = await build({ entryPoints: [fileURLToPath(new URL('../src/insights/pace.ts', import.meta.url))], bundle: true, write: false, format: 'esm' });
const { percentagePace } = await import(`data:text/javascript;base64,${Buffer.from(math.outputFiles[0].text).toString('base64')}`);
class Element {
	constructor(tag='div') { this.tag=tag;this.children=[];this.listeners=new Map();this.attributes={};this.dataset={};this.classList={add(){}};this.ownerDocument={createElementNS:(_,tag)=>new Element(tag)};this.clientWidth=240;this.hidden=false; }
	setAttribute(k,v){this.attributes[k]=v;}
	appendChild(el){this.children.push(el);return el;}
	createEl(tag, options={}){const el=new Element(tag);if(options.cls)el.setAttribute('class',options.cls);if(options.text)el.textContent=options.text;for(const[k,v]of Object.entries(options.attr??{}))el.setAttribute(k,v);return this.appendChild(el);}
	createDiv(options){return this.createEl('div',options);}
	createSpan(options){return this.createEl('span',options);}
	replaceChildren(){this.children=[];}
	empty(){this.replaceChildren();}
	getBoundingClientRect(){return{left:0};}
	trigger(name,props={}){const e={target:this,prevented:false,preventDefault(){this.prevented=true;},stopPropagation(){},...props};this.listeners.get(name)?.(e);return e;}
}
const nodes = el => [el,...el.children.flatMap(nodes)];
globalThis.ResizeObserver=class{};
function fixture(t,lazy=false){
	const disconnected=[];let visibility;
	t.mock.method(globalThis,'ResizeObserver',function(){return{observe(){},disconnect(){disconnected.push('resize');}};});
	if(lazy){globalThis.IntersectionObserver=class{constructor(fn){visibility=fn;}observe(){}disconnect(){disconnected.push('intersection');}};t.after(()=>delete globalThis.IntersectionObserver);}
	const root=new Element(), graph=new PaceGraph(root);
	const update=(progress=40,extra={})=>graph.update(percentagePace({progress,start:'2026-10-04',deadline:'2026-10-18',...extra},'2026-10-07'));
	update();return{root,graph,tooltip:root.children[1],update,disconnected,visible:()=>visibility?.([{isIntersecting:true}])};
}

test('renders actual pace, unchanged required target and a dotted estimated-finish continuation',t=>{
	const f=fixture(t);const svg=f.root.children[0];
	const paths=nodes(svg).filter(el=>el.tag==='path');
	assert.equal(paths.filter(el=>el.attributes.class?.includes('horizon-insights-line')).length,3);
	assert.equal(paths.filter(el=>el.attributes.class?.includes('horizon-insights-projection')).length,2);
	assert.ok(nodes(svg).some(el=>el.tag==='circle'&&el.attributes.r==='4.5'));
	assert.match(f.root.attributes['aria-label'],/40% actual, 21.43% required/);
	assert.match(f.root.attributes['aria-label'],/not recorded history/);
});

test('cards show only their title, progress and compact dates by default, and title navigation follows updates',t=>{
	t.mock.method(globalThis,'ResizeObserver',function(){return{observe(){},disconnect(){}};});
	const root=new Element(), opened=[];
	const item={kind:'project',entry:{text:'Build productivity tools',file:{path:'tools.md'}},progress:50,start:'2026-10-01',deadline:'2026-10-13'};
	const card=new PaceCard(root,item,entry=>opened.push(entry));card.update(item);
	const visibleText=nodes(root).filter(el=>!el.hidden&&el.textContent).map(el=>el.textContent);
	assert.deepEqual(visibleText.slice(0,2),['Build productivity tools','50%']);
	assert.ok(visibleText.slice(2).every(text=>/^\d{1,2}\.\d{1,2}$/.test(text)));
	assert.ok(!nodes(root).some(el=>['details','summary','table'].includes(el.tag)));
	const icon=nodes(root).find(el=>el.attributes.class==='horizon-insights-progress-icon');
	assert.equal(icon.attributes['aria-hidden'],'true');
	assert.equal(nodes(icon).filter(el=>el.tag==='svg').length,1);
	assert.ok(nodes(icon).some(el=>el.tag==='path'&&el.attributes.d?.includes('A 6 6')));
	const renamed={...item,entry:{text:'Updated title',file:{path:'renamed.md'}},progress:75};card.update(renamed);
	const link=nodes(root).find(el=>el.tag==='a');link.trigger('click');
	assert.equal(link.textContent,'Updated title');assert.equal(link.href,'renamed.md');assert.deepEqual(opened,[renamed]);
	assert.equal(nodes(icon).filter(el=>el.tag==='svg').length,1);
	card.update({...renamed,progress:100});assert.ok(nodes(icon).some(el=>el.tag==='circle'&&el.attributes.r==='6'));
	card.update({...renamed,progress:0});assert.equal(nodes(icon).filter(el=>el.tag==='path').length,0);
	card.unload();assert.equal(link.listeners.size,0);
});

test('two-column mobile graph widths stay proportional and preserve inspectable anchors',t=>{
	const f=fixture(t);
	for(const width of [90,120,150]) {
		f.root.clientWidth=width;f.update(10);
		const svg=f.root.children[0], [, , renderedWidth, renderedHeight]=svg.attributes.viewBox.split(' ').map(Number);
		assert.equal(renderedWidth,width);assert.ok(renderedHeight<width*1.5);
		for(const label of nodes(svg).filter(el=>el.tag==='text'))assert.ok(Number(label.attributes.x)>=0&&Number(label.attributes.x)<=width);
		f.root.trigger('keydown',{key:'End'});assert.match(f.tooltip.textContent,/Estimated finish/);
	}
});

test('axis has compact endpoint dates without percentage ticks, with a middle deadline aligned to its marker',t=>{
	const f=fixture(t);f.update(10);
	const elements=nodes(f.root.children[0]), labels=elements.filter(el=>el.tag==='text');
	assert.deepEqual(labels.map(el=>el.textContent),['4.10','18.10','3.11']);
	const marker=elements.find(el=>el.attributes.class==='horizon-insights-deadline');
	assert.equal(labels[1].attributes.x,marker.attributes.x1);
	assert.equal(labels[1].attributes.y,labels[0].attributes.y);
	const topOffset=Number(labels[1].attributes.style.match(/(-?[\d.]+)px/)[1]);
	assert.ok(Number(labels[1].attributes.y)+topOffset<Number(marker.attributes.y1));
	assert.ok(labels[1].attributes.class.includes('horizon-pace-interior-date'));
	assert.equal(labels[0].attributes.style,undefined);
	assert.equal(labels[2].attributes.style,undefined);
	assert.equal(f.tooltip.hidden,true);
	f.root.trigger('keydown',{key:'End'});assert.match(f.tooltip.textContent,/Estimated finish/);
});

test('an endpoint deadline is labeled once and a nearby middle deadline uses another row instead of overlapping',t=>{
	const f=fixture(t);
	assert.deepEqual(nodes(f.root.children[0]).filter(el=>el.tag==='text').map(el=>el.textContent),['4.10','18.10']);
	f.update(40,{deadline:'2026-10-11'});
	const labels=nodes(f.root.children[0]).filter(el=>el.tag==='text');
	assert.deepEqual(labels.map(el=>el.textContent),['4.10','11.10','12.10']);
	assert.ok(Number(labels[1].attributes.y)>Number(labels[2].attributes.y));
	f.update(100,{start:'2026-10-07',deadline:'2026-10-07'});
	assert.deepEqual(nodes(f.root.children[0]).filter(el=>el.tag==='text').map(el=>el.textContent),['7.10']);
});
test('zero-progress dated entries show their required line and inspectable deadline without a finish estimate',t=>{
	const f=fixture(t);f.update(0);
	const svg=f.root.children[0], elements=nodes(svg);
	assert.equal(elements.filter(el=>el.attributes.class==='horizon-insights-deadline').length,1);
	assert.equal(elements.filter(el=>el.tag==='path'&&el.attributes.class?.includes('horizon-insights-projection')).length,1);
	assert.match(f.root.attributes['aria-label'],/0% actual, 21.43% required/);
	f.root.trigger('keydown',{key:'End'});assert.match(f.tooltip.textContent,/Deadline.*100% required target/);
	assert.doesNotMatch(f.root.attributes['aria-label'],/estimated finish/);
});
test('keyboard exposes labeled anchors and current actuals, not fabricated historical percentages',t=>{
	const f=fixture(t);
	f.root.trigger('keydown',{key:'Home'});assert.match(f.tooltip.textContent,/0% implied anchor, not an observation/);
	f.root.trigger('keydown',{key:'ArrowRight'});assert.match(f.tooltip.textContent,/40% actual.*21.43% required/);
	f.root.trigger('keydown',{key:'ArrowRight'});assert.match(f.tooltip.textContent,/Estimated finish.*not a deadline/);
	f.root.trigger('keydown',{key:'End'});assert.match(f.tooltip.textContent,/100% required target, not a forecast/);
	f.root.trigger('keydown',{key:'Escape'});assert.equal(f.tooltip.hidden,true);
	assert.equal(f.root.trigger('keydown',{key:'ArrowRight',ctrlKey:true}).prevented,false);
	assert.equal(f.root.trigger('keydown',{key:'ArrowRight',target:{}}).prevented,false);
	assert.equal(f.root.trigger('keydown',{key:'g'}).prevented,false);
	f.graph.unload();assert.equal(f.root.listeners.size,0);assert.deepEqual(f.disconnected,['resize']);
});
test('touch taps inspect values; scrolling, cancellation, blur and redraw clear selection',t=>{
	const f=fixture(t);
	f.root.trigger('pointerdown',{pointerType:'touch',clientX:100,clientY:10});f.root.trigger('pointerup',{pointerType:'touch',clientX:100,clientY:10});assert.equal(f.tooltip.hidden,false);
	f.root.trigger('pointerdown',{pointerType:'touch',clientX:100,clientY:10});f.root.trigger('pointermove',{pointerType:'touch',clientX:100,clientY:30});f.root.trigger('pointerup',{pointerType:'touch',clientX:100,clientY:30});assert.equal(f.tooltip.hidden,true);
	f.root.trigger('pointermove',{pointerType:'mouse',clientX:100});assert.equal(f.tooltip.hidden,false);
	f.root.trigger('pointercancel');assert.equal(f.tooltip.hidden,true);
	f.root.trigger('keydown',{key:'Home'});f.root.trigger('blur');assert.equal(f.tooltip.hidden,true);
	f.root.trigger('keydown',{key:'Home'});f.update(85);assert.equal(f.tooltip.hidden,true);
});
test('lazy rendering and observers clean up; invalid schedules have no lines and same-day targets stay points',t=>{
	const f=fixture(t,true);assert.equal(f.root.children[0].children.length,0);f.visible();assert.ok(f.root.children[0].children.length>0);
	for(const extra of [{start:undefined},{deadline:'2026-10-04'},{start:'2026-10-20',deadline:'2026-10-30'}]){
		f.update(40,extra);const lines=nodes(f.root.children[0]).filter(el=>el.tag==='path'&&el.attributes.class?.includes('horizon-insights-line'));
		assert.equal(lines.length,extra.start==='2026-10-20'?1:extra.deadline==='2026-10-04'?2:0);
	}
	f.graph.unload();assert.deepEqual(f.disconnected,['resize','intersection']);
});

test('coincident deadline and estimated finish keep distinct keyboard labels',t=>{
	const f=fixture(t);f.update(37.5,{deadline:'2026-10-12'});
	f.root.trigger('keydown',{key:'Home'});
	f.root.trigger('keydown',{key:'ArrowRight'});assert.match(f.tooltip.textContent,/Today/);
	f.root.trigger('keydown',{key:'ArrowRight'});assert.match(f.tooltip.textContent,/Deadline.*required target/);
	f.root.trigger('keydown',{key:'ArrowRight'});assert.match(f.tooltip.textContent,/Estimated finish.*not a deadline/);
});

test('finish estimates beyond the deadline extend the domain without replacing its target',t=>{
	const f=fixture(t);f.update(10);
	assert.equal(nodes(f.root.children[0]).filter(el=>el.attributes.class==='horizon-insights-deadline').length,1);
	f.root.trigger('keydown',{key:'End'});assert.match(f.tooltip.textContent,/Estimated finish/);
	f.root.trigger('keydown',{key:'ArrowLeft'});assert.match(f.tooltip.textContent,/Deadline/);
});

test('open-ended pace draws a dotted continuation and exposes an estimated finish, not a deadline',t=>{
	const f=fixture(t);f.update(40,{deadline:undefined});
	const lines=nodes(f.root.children[0]).filter(el=>el.tag==='path'&&el.attributes.class?.includes('horizon-insights-line'));
	assert.equal(lines.length,2); assert.ok(lines.some(el=>el.attributes.class.includes('horizon-insights-projection')));
	assert.equal(nodes(f.root.children[0]).filter(el=>el.attributes.class==='horizon-insights-deadline').length,0);
	f.root.trigger('keydown',{key:'End'});assert.match(f.tooltip.textContent,/Estimated finish.*not a deadline/);
	assert.match(f.root.attributes['aria-label'],/estimated finish/);
});
