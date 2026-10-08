import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const component = `
export class Component {
 constructor(){this.children=new Set();this.cleanups=[];this.unloaded=0;}
 addChild(child){this.children.add(child);return child;}
 removeChild(child){if(this.children.delete(child))child.unload();}
 register(fn){this.cleanups.push(fn);}
 registerEvent(event){this.register(()=>event.off?.());}
 registerDomEvent(el,name,fn){el.addEventListener(name,fn);this.register(()=>el.removeEventListener(name,fn));}
 unload(){this.unloaded++;for(const child of [...this.children])this.removeChild(child);for(const fn of this.cleanups.splice(0))fn();}
}
export class ItemView extends Component {
 constructor(leaf){super();this.leaf=leaf;this.app=leaf.app;this.contentEl=leaf.contentEl;}
}
export class Notice {}
`;
const output = await build({
	entryPoints: [fileURLToPath(new URL('../src/insights/view.ts', import.meta.url))],
	bundle: true, write: false, format: 'esm', plugins: [{
		name: 'insights-view-fixture', setup(builder) {
			builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'fixture' }));
			builder.onResolve({ filter: /(?:^|\/)pace-card$/ }, () => ({ path: 'card', namespace: 'fixture' }));
			builder.onResolve({ filter: /(?:^|\/)option-keyboard-shortcuts$/ }, () => ({ path: 'shortcuts', namespace: 'fixture' }));
			builder.onResolve({ filter: /(?:^|\/)open-note$/ }, () => ({ path: 'open-note', namespace: 'fixture' }));
			builder.onResolve({ filter: /(?:^|\/)icons$/ }, () => ({ path: 'icons', namespace: 'fixture' }));
			builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'js', contents: {
				obsidian: component,
				card: `import { Component } from 'obsidian';
export class PaceCard extends Component {
 constructor(root,item,open){super();this.item=item;this.updates=[];this.container=root.createEl('article',{cls:'horizon-insights-goal'});this.link=this.container.createEl('a',{attr:{'data-focus-role':'title'}});this.registerDomEvent(this.link,'click',()=>open(this.item));}
 update(item){this.item=item;this.updates.push(item);this.container.dataset.kind=item.kind;this.container.dataset.path=item.identity.path;this.link.textContent=item.entry.text;}
}`,
				shortcuts: `import { Component } from 'obsidian';export class OptionKeyboardShortcuts extends Component {constructor(root,context){super();this.root=root;this.context=context;}}`,
				'open-note': `export async function openNoteInCurrentTab(vault,leaf,path,line){vault.opened.push({leaf,path,line});}`,
				icons: `export const INSIGHTS_ICON='horizon-insights';`,
			}[path] }));
		},
	}],
});
const { HorizonInsightsView, HORIZON_INSIGHTS_VIEW_TYPE } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

class Element {
	constructor(tag = 'div', ownerDocument = { activeElement: undefined }) {
		this.tag = tag; this.ownerDocument = ownerDocument; this.children = []; this.parentElement = null;
		this.attributes = {}; this.dataset = {}; this.classes = new Set(); this.style = {}; this.listeners = new Map();
		this.textContent = ''; this.hidden = false;
	}
	addClass(...classes) { for (const value of classes) for (const cls of value.split(/\s+/)) if (cls) this.classes.add(cls); }
	removeClass(...classes) { for (const cls of classes) this.classes.delete(cls); }
	toggleClass(cls, enabled) { if (enabled) this.classes.add(cls); else this.classes.delete(cls); }
	setAttribute(name, value) { this.attributes[name] = String(value); }
	getAttribute(name) { return this.attributes[name] ?? null; }
	hasAttribute(name) { return name in this.attributes; }
	removeAttribute(name) { delete this.attributes[name]; }
	setCssProps(values) { Object.assign(this.style, values); }
	createEl(tag, options = {}) {
		const el = new Element(tag, this.ownerDocument);
		if (options.cls) el.addClass(options.cls);
		if (options.text) el.textContent = options.text;
		for (const [name, value] of Object.entries(options.attr ?? {})) el.setAttribute(name, value);
		return this.appendChild(el);
	}
	createDiv(options) { return this.createEl('div', options); }
	createSpan(options) { return this.createEl('span', options); }
	appendChild(el) { el.remove(); el.parentElement = this; this.children.push(el); return el; }
	insertBefore(el, before) {
		if (el === before) return el;
		el.remove(); const index = before === null ? this.children.length : this.children.indexOf(before);
		assert.ok(index >= 0, 'insertBefore reference must belong to its parent');
		this.children.splice(index, 0, el); el.parentElement = this; return el;
	}
	contains(el) { return el === this || this.children.some(child => child.contains(el)); }
	remove() {
		if (!this.parentElement) return;
		if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = undefined;
		const parent = this.parentElement; parent.children.splice(parent.children.indexOf(this), 1); this.parentElement = null;
	}
	empty() { for (const child of [...this.children]) child.remove(); this.textContent = ''; }
	closest(selector) { for (let el = this; el; el = el.parentElement) if (matches(el, selector)) return el; return null; }
	querySelector(selector) { return descendants(this).slice(1).find(el => matches(el, selector)) ?? null; }
	querySelectorAll(selector) { return descendants(this).slice(1).filter(el => selector.split(',').some(part => matches(el, part.trim()))); }
	addEventListener(name, fn) { this.listeners.set(name, fn); }
	removeEventListener(name, fn) { if (this.listeners.get(name) === fn) this.listeners.delete(name); }
	focus() { this.ownerDocument.activeElement = this; }
	click() { this.listeners.get('click')?.({ target: this, preventDefault() {} }); }
}
const matches = (el, selector) => selector.startsWith('.') ? el.classes.has(selector.slice(1))
	: selector.startsWith('[') ? el.hasAttribute(selector.slice(1, -1)) : el.tag === selector;
const descendants = el => [el, ...el.children.flatMap(descendants)];
const findAll = (root, cls) => descendants(root).filter(el => el.classes.has(cls));
const snapshot = (kind, path, progress = 50, start = '2026-10-01', extra = {}) => ({
	kind, identity: { path }, entry: { file: { path }, text: path.replace(/\.md$/, '') }, progress, start, ...extra,
});
const cardsFor = section => findAll(section, 'horizon-insights-goal');

function fixture(t, { goals = [], projects = [], ready = true } = {}) {
	const content = new Element(); const outer = new Element('div', content.ownerDocument); outer.addClass('workspace-leaf-content');
	const title = outer.createDiv({ cls: 'view-header-title' }); outer.appendChild(content);
	const subscriptions = new Set(); const selections = []; const configEvents = [];
	const service = {
		goals, projects, ready,
		history(item) { return item.historyId ? { id: item.historyId } : undefined; },
		subscribe(fn) { subscriptions.add(fn); return () => subscriptions.delete(fn); },
	};
	let active;
	const vault = {
		opened: [],
		getConfig() { throw new Error('Insights must not read the note-width preference'); },
		on(name, fn) { const event = { name, fn, off() { configEvents.splice(configEvents.indexOf(event), 1); } }; configEvents.push(event); return event; },
	};
	const leaf = { contentEl: content, app: { vault, workspace: { getActiveViewOfType() { return active; } } } };
	const view = new HorizonInsightsView(leaf, service, () => { throw new Error('Insights must not read content-width settings'); }, option => selections.push(option));
	active = view;
	t.after(async () => { await view.onClose(); view.unload(); });
	return {
		view, content, title, leaf, vault, service, subscriptions, selections, configEvents,
		publish(nextGoals, nextProjects, nextReady = true) {
			service.goals = nextGoals; service.projects = nextProjects; service.ready = nextReady;
			for (const fn of [...subscriptions]) fn();
		},
		section(label) { return findAll(content, 'horizon-insights-section').find(section => section.querySelector('h2')?.textContent === label); },
		setActive(value) { active = value; },
	};
}

test('Insights shows a screen title and groups eligible cards without the note-width wrapper', async t => {
	const f = fixture(t, {
		goals: [snapshot('goal', 'Goal A.md'), snapshot('goal', 'Zero goal.md', 0), snapshot('goal', 'Undated goal.md', 50, null), snapshot('goal', 'Goal B.md', 100)],
		projects: [snapshot('project', 'Zero project.md', 0), snapshot('project', 'Project B.md'), snapshot('project', 'Undated project.md', 50, null), snapshot('project', 'Invalid date.md', 50, '2026-02-30')],
	});
	await f.view.onOpen();
	assert.equal(f.view.getViewType(), HORIZON_INSIGHTS_VIEW_TYPE); assert.equal(HORIZON_INSIGHTS_VIEW_TYPE, 'horizon-insights');
	assert.equal(f.view.getDisplayText(), 'Insights'); assert.equal(f.title.textContent, 'Insights');
	assert.equal(findAll(f.content, 'horizon-insights-title').length, 1);
	assert.equal(findAll(f.content, 'horizon-insights-title')[0].textContent, 'Insights');
	assert.deepEqual(findAll(f.content, 'horizon-insights-section-title').map(el => el.textContent), ['Goals', 'Projects']);
	assert.deepEqual(cardsFor(f.section('Goals')).map(el => el.dataset.path), ['Goal A.md', 'Goal B.md']);
	assert.deepEqual(cardsFor(f.section('Projects')).map(el => el.dataset.path), ['Zero project.md', 'Project B.md']);
	assert.equal(findAll(f.content, 'horizon-insights-grid').length, 2);
	assert.equal(f.content.children[0].classes.has('horizon-insights-content'), true);
	for (const cls of ['horizon-notes', 'horizon-note-results', 'inline-title', 'horizon-note-count', 'markdown-reading-view', 'is-readable-line-width']) {
		assert.equal(findAll(f.content, cls).length, 0, `${cls} must not constrain or add text to Insights`);
	}
	assert.equal(findAll(f.content, 'horizon-insights-empty')[0].hidden, true);
});

test('empty sections stay hidden while loading and when eligibility changes', async t => {
	const f = fixture(t, { ready: false }); await f.view.onOpen();
	const empty = findAll(f.content, 'horizon-insights-empty')[0];
	assert.equal(empty.hidden, false); assert.equal(empty.textContent, 'Loading progress…');
	assert.ok(findAll(f.content, 'horizon-insights-section').every(section => section.hidden));
	f.publish([], [snapshot('project', 'Standalone project.md', 0)]);
	assert.equal(f.section('Goals').hidden, true); assert.equal(f.section('Projects').hidden, false); assert.equal(empty.hidden, true);
	f.publish([snapshot('goal', 'Goal.md')], []);
	assert.equal(f.section('Goals').hidden, false); assert.equal(f.section('Projects').hidden, true);
	f.publish([snapshot('goal', 'Zero goal.md', 0)], []);
	assert.ok(findAll(f.content, 'horizon-insights-section').every(section => section.hidden));
	assert.equal(empty.hidden, false); assert.match(empty.textContent, /Add a start date; goals also need progress/);
	assert.equal(findAll(f.content, 'horizon-insights-goal').length, 0);
});

test('refreshes reuse cards through safe goal renames, keep focus, reorder by section and unload removed cards', async t => {
	const a = snapshot('goal', 'Goal A.md', 50, '2026-10-01', { historyId: 'stable-a' });
	const b = snapshot('goal', 'Goal B.md', 50, '2026-10-01', { historyId: 'stable-b' });
	const p = snapshot('project', 'Project.md');
	const f = fixture(t, { goals: [a, b], projects: [p] }); await f.view.onOpen();
	const original = [...f.view.children].find(child => child.item?.identity.path === a.identity.path);
	const removed = [...f.view.children].find(child => child.item?.identity.path === p.identity.path);
	original.link.focus();
	const renamed = snapshot('goal', 'Renamed goal.md', 75, '2026-10-01', { historyId: 'stable-a' });
	f.publish([b, renamed], []);
	assert.deepEqual(original.item, renamed); assert.equal(original.container.dataset.path, 'Renamed goal.md');
	assert.equal(f.content.ownerDocument.activeElement, original.link);
	assert.deepEqual(cardsFor(f.section('Goals')).map(el => el.dataset.path), ['Goal B.md', 'Renamed goal.md']);
	assert.equal(original.container.parentElement.classes.has('horizon-insights-grid'), true);
	assert.equal(removed.unloaded, 1); assert.equal(removed.container.parentElement, null); assert.equal(removed.link.listeners.size, 0);
	assert.equal(f.section('Projects').hidden, true);
	assert.equal([...f.view.children].filter(child => child.item).length, 2);
});

test('refreshing a focused card into a new position restores its existing title focus', async t => {
	const a = snapshot('goal', 'Goal A.md', 50, '2026-10-01', { historyId: 'stable-a' });
	const b = snapshot('goal', 'Goal B.md', 50, '2026-10-01', { historyId: 'stable-b' });
	const c = snapshot('goal', 'Goal C.md', 50, '2026-10-01', { historyId: 'stable-c' });
	const f = fixture(t, { goals: [a, b, c] }); await f.view.onOpen();
	const focused = [...f.view.children].find(child => child.item?.identity.path === c.identity.path);
	focused.link.focus();
	f.publish([c, a, b], []);
	assert.deepEqual(cardsFor(f.section('Goals')).map(el => el.dataset.path), ['Goal C.md', 'Goal A.md', 'Goal B.md']);
	assert.equal(cardsFor(f.section('Goals'))[0], focused.container);
	assert.equal(f.content.ownerDocument.activeElement, focused.link);
	assert.equal(focused.unloaded, 0);
});

test('Insights ignores note-width and legacy expanded-value state while retaining current-title navigation and option shortcuts', async t => {
	const f = fixture(t, { goals: [snapshot('goal', 'Goal.md', 50, '2026-10-01', { historyId: 'stable-goal' })] });
	f.view.applySettings(); await f.view.onOpen(); f.view.applySettings();
	await f.view.setState({ expandedValues: ['Goal.md'], optionId: 'insights' }, {});
	assert.deepEqual(f.view.getState(), { optionId: 'insights' }); assert.deepEqual(f.content.style, {});
	assert.equal(f.content.classes.has('horizon-custom-width'), false);
	assert.equal(descendants(f.content).some(el => ['details', 'summary', 'table'].includes(el.tag)), false);
	const card = [...f.view.children].find(child => child.item);
	const updated = snapshot('goal', 'Updated goal.md', 75, '2026-10-01', {
		historyId: 'stable-goal', identity: { path: 'Updated goal.md', line: 8 },
		entry: { file: { path: 'Updated goal.md' }, text: 'Updated goal', line: 8 },
	});
	f.publish([updated], []);
	assert.equal([...f.view.children].find(child => child.item), card);
	card.link.click(); await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(f.vault.opened, [{ leaf: f.leaf, path: 'Updated goal.md', line: 8 }]);
	const shortcuts = [...f.view.children].find(child => child.context);
	assert.equal(shortcuts.root, f.content); assert.equal(shortcuts.context.isActive(), true);
	f.setActive(undefined); assert.equal(shortcuts.context.isActive(), false);
	shortcuts.context.activate({ id: 'projects' }); assert.deepEqual(f.selections, [{ id: 'projects' }]);
	f.view.focus(); assert.equal(f.content.ownerDocument.activeElement, f.content);
});

test('closing and reopening Insights cleans up card children and subscriptions without duplicate updates', async t => {
	const item = snapshot('project', 'Project.md'); const f = fixture(t, { projects: [item] }); await f.view.onOpen();
	const children = [...f.view.children]; assert.equal(f.subscriptions.size, 1);
	await f.view.onClose();
	assert.equal(f.subscriptions.size, 0); assert.equal(f.view.children.size, 0); assert.equal(f.content.children.length, 0);
	assert.ok(children.every(child => child.unloaded === 1));
	f.publish([], [snapshot('project', 'Later project.md')]); assert.equal(f.content.children.length, 0);
	await f.view.onOpen(); assert.equal(f.subscriptions.size, 1);
	assert.deepEqual(cardsFor(f.section('Projects')).map(el => el.dataset.path), ['Later project.md']);
	const card = [...f.view.children].find(child => child.item); const updates = card.updates.length;
	f.publish([], [snapshot('project', 'Later project.md', 75)]);
	assert.equal(card.updates.length, updates + 1);
});
