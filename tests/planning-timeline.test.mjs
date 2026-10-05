import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { build } = createRequire(import.meta.url)('esbuild');
const code = (await build({
	stdin: { contents: "export * from './scale'; export * from './interactions'; export * from './dependencies';",
		loader: 'ts', resolveDir: fileURLToPath(new URL('../src/timeline/', import.meta.url)) },
	bundle: true, write: false, format: 'esm', plugins: [{ name: 'mock-obsidian', setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
		build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export class Component {
			cleanups=[];
			register(fn){this.cleanups.push(fn);}
			registerDomEvent(el,type,fn,options){el.addEventListener(type,fn,options);this.register(()=>el.removeEventListener(type,fn,options));}
			unload(){this.cleanups.splice(0).reverse().forEach(fn=>fn());}
		}`, loader: 'js' }));
	} }],
})).outputFiles[0].text;
const { timelineLayout, dateToPixel, pixelToDate, barGeometry, resizeDates, clampZoom,
	TimelineInteractions, renderDependencies } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('timeline windows respect month, quarter, leap year, and five-year boundaries', () => {
	assert.deepEqual([timelineLayout('2028-02-19', 'month', 1).start,
		timelineLayout('2028-02-19', 'month', 1).end, timelineLayout('2028-02-19', 'month', 1).days],
	['2028-02-01', '2028-03-01', 29]);
	const quarter = timelineLayout('2026-08-05', 'quarter', 1);
	assert.equal(quarter.start, '2026-07-01');
	assert.equal(quarter.end, '2026-10-01');
	assert.equal(quarter.days, 92);
	assert.equal(timelineLayout('2028-10-05', 'year', 1).days, 366);
	assert.equal(timelineLayout('2026-10-05', 'five-years', 1).end, '2031-01-01');
	assert.equal(timelineLayout('2026-10-05', 'five-years', 1).days, 1826);
	assert.equal(clampZoom(100), 8);
	assert.equal(clampZoom(0), 0.5);
	assert.equal(clampZoom(NaN), 1);
});

test('pixel boundaries round-trip civil dates at every supported scale and fractional zoom', () => {
	for (const scale of ['month', 'quarter', 'year', 'five-years']) {
		for (const zoom of [0.5, 1, 1.25, 8]) {
			const layout = timelineLayout('2028-02-10', scale, zoom);
			for (let day = 0; day < layout.days; day++) {
				const date = pixelToDate((day + 0.5) * layout.pixelsPerDay, layout);
				assert.equal(pixelToDate(dateToPixel(date, layout), layout), date);
			}
			assert.equal(pixelToDate(-1, layout), layout.start);
			assert.equal(pixelToDate(layout.width, layout), pixelToDate(layout.width - 0.01, layout));
		}
	}
	const layout = timelineLayout('2028-02-10', 'month', 1);
	assert.equal(pixelToDate(29.99, layout), '2028-02-01');
	assert.equal(pixelToDate(30, layout), '2028-02-02');
});

test('bars include deadline day and clip offscreen ranges without negative widths', () => {
	const layout = timelineLayout('2026-10-05', 'month', 1);
	assert.deepEqual(barGeometry({ start: '2026-10-05', end: '2026-10-05' }, layout),
		{ left: 120, width: 30, before: false, after: false, single: true });
	const clipped = barGeometry({ start: '2026-09-29', end: '2026-11-02' }, layout);
	assert.equal(clipped.left, 0);
	assert.equal(clipped.width, 930);
	assert.equal(clipped.before, true);
	assert.equal(clipped.after, true);
	assert.equal(barGeometry({ start: '2026-11-01', end: '2026-11-03' }, layout), undefined);
	assert.equal(barGeometry({ start: '2026-09-28', end: '2026-09-30' }, layout), undefined);
});

test('edge resize clamps to the opposite edge and expands one-date markers deliberately', () => {
	assert.deepEqual(resizeDates({ start: '2026-10-05', deadline: '2026-10-10' }, 'start', '2026-10-20'),
		{ start: '2026-10-10', deadline: '2026-10-10' });
	assert.deepEqual(resizeDates({ deadline: '2026-10-10' }, 'start', '2026-10-05'),
		{ start: '2026-10-05', deadline: '2026-10-10' });
	assert.deepEqual(resizeDates({ start: '2026-10-05' }, 'deadline', '2026-10-15'),
		{ start: '2026-10-05', deadline: '2026-10-15' });
});

function emit(el, name, properties = {}) {
	const event = new Event(name, { cancelable: true });
	for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
	el.dispatchEvent(event);
	return event;
}

function interactionFixture(project) {
	const doc = new EventTarget();
	const viewport = new EventTarget();
	viewport.ownerDocument = doc;
	viewport.scrollLeft = 0;
	viewport.getBoundingClientRect = () => ({ left: 0, width: 1200 });
	viewport.removeClass = viewport.addClass = () => {};
	viewport.setPointerCapture = viewport.releasePointerCapture = () => {};
	viewport.hasPointerCapture = () => false;
	viewport.contains = () => false;
	const row = { dataset: { timelineRow: project.id } };
	const target = { closest: selector => selector === '[data-timeline-row]' ? row : null };
	const saves = [];
	const edits = [];
	const preview = [];
	let cleared = 0;
	const context = { projects: [project], warnings: [], date: '2026-10-05',
		saveDates: async (project, dates) => { saves.push({ id: project.id, dates }); },
		edit: (project, dates) => edits.push(dates), open: () => {} };
	const layout = timelineLayout(context.date, 'month', 1);
	const interaction = new TimelineInteractions(viewport, context, () => layout,
		(project, dates) => preview.push(dates), () => cleared++, () => {});
	const pointer = { target, isPrimary: true, button: 0, pointerId: 1, clientX: 330 };
	return { viewport, doc, target, saves, edits, preview, interaction, pointer,
		get cleared() { return cleared; } };
}

const baseProject = { id: 'a', path: 'A.md', title: 'A', status: 'todo', dependencies: [] };

test('planning a row writes only on pointerup and suppresses the synthetic click', () => {
	const fixture = interactionFixture(baseProject);
	emit(fixture.viewport, 'pointerdown', fixture.pointer);
	emit(fixture.doc, 'pointermove', { ...fixture.pointer, clientX: 450 });
	assert.deepEqual(fixture.preview.at(-1), { start: '2026-10-05', deadline: '2026-10-09' });
	assert.equal(fixture.saves.length, 0);
	emit(fixture.doc, 'pointerup', { ...fixture.pointer, clientX: 450 });
	assert.deepEqual(fixture.saves, [{ id: 'a', dates: { start: '2026-10-05', deadline: '2026-10-09' } }]);
	assert.equal(emit(fixture.viewport, 'click', { target: fixture.target }).defaultPrevented, true);
	assert.equal(fixture.edits.length, 0);
	fixture.interaction.unload();
});

test('Escape, pointer cancellation, and unload discard pending dates and remove listeners', () => {
	for (const end of ['escape', 'pointercancel', 'unload']) {
		const fixture = interactionFixture(baseProject);
		emit(fixture.viewport, 'pointerdown', fixture.pointer);
		emit(fixture.doc, 'pointermove', { ...fixture.pointer, clientX: 450 });
		if (end === 'escape') emit(fixture.doc, 'keydown', { key: 'Escape' });
		if (end === 'pointercancel') emit(fixture.doc, 'pointercancel', fixture.pointer);
		if (end === 'unload') fixture.interaction.unload();
		emit(fixture.doc, 'pointerup', fixture.pointer);
		assert.equal(fixture.saves.length, 0);
		assert.ok(fixture.cleared > 0);
		fixture.interaction.unload();
	}
});

test('native bar moves preserve deadline-only data and use the drag grab offset', () => {
	const project = { ...baseProject, deadline: '2026-10-05' };
	const fixture = interactionFixture(project);
	const transfer = { values: new Map(), getData(type) { return this.values.get(type) ?? ''; },
		setData(type, value) { this.values.set(type, value); }, types: ['application/x-horizon-project'] };
	const bar = { dataset: { timelineBar: 'a' } };
	const target = { closest: selector => selector === '[data-timeline-bar]' ? bar : fixture.target.closest(selector) };
	emit(fixture.viewport, 'dragstart', { target, clientX: 330, dataTransfer: transfer });
	emit(fixture.viewport, 'drop', { target: fixture.target, clientX: 450, dataTransfer: transfer });
	assert.deepEqual(fixture.saves[0]?.dates, { deadline: '2026-10-09' });
	assert.equal(transfer.getData('application/x-horizon-project'), 'a');
	fixture.interaction.unload();
});

test('dependency arrows resolve whole-note rows and completed predecessors have no conflict styling', () => {
	const doc = { createElementNS(ns, tag) { return { tag, attrs: {}, classes: [], children: [],
		classList: { add(value) { this.owner.classes.push(value); } },
		setAttribute(key, value) { this.attrs[key] = value; }, appendChild(child) { this.children.push(child); } }; } };
	const originalCreate = doc.createElementNS;
	doc.createElementNS = (...args) => { const element = originalCreate(...args); element.classList.owner = element; return element; };
	const svg = { ownerDocument: doc, attrs: {}, children: [], replaceChildren() { this.children = []; },
		setAttribute(key, value) { this.attrs[key] = value; }, appendChild(child) { this.children.push(child); } };
	const predecessor = { ...baseProject, id: 'b', path: 'B.md', title: 'B', status: 'completed', start: '2026-10-01', deadline: '2026-10-20' };
	const successor = { ...baseProject, start: '2026-10-10', deadline: '2026-10-25', dependencies: [{ path: 'B.md', title: 'B' }] };
	const inline = { ...predecessor, id: 'inline-b', inline: { line: 1, sourceLine: '- B #projects' } };
	renderDependencies(svg, { projects: [predecessor, successor, inline] }, timelineLayout('2026-10-05', 'month', 1));
	assert.equal(svg.children.length, 2);
	assert.match(svg.children[0].attrs.d, /^M 600 24 /);
	assert.equal(svg.children[0].classes.includes('is-conflict'), false);
});
