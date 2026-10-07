import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({
	entryPoints: [fileURLToPath(new URL('../src/ui/goal-progress-sync.ts', import.meta.url))],
	bundle: true, write: false, format: 'esm', plugins: [{
		name: 'mock-obsidian', setup(builder) {
			builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test' }));
			builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ loader: 'js', contents: `
				export const parseFrontMatterTags = fm => {
					const tags = Array.isArray(fm?.tags) ? fm.tags : typeof fm?.tags === 'string' ? fm.tags.split(/[\\s,]+/) : [];
					return tags.filter(tag => typeof tag === 'string' && tag.trim()).map(tag => tag.startsWith('#') ? tag : '#' + tag);
				};
				export const debounce = fn => Object.assign((...args) => {
					if (globalThis.horizonTestRefreshQueue) globalThis.horizonTestRefreshQueue.push(() => fn(...args));
					else fn(...args);
				}, { cancel() {} });
			` }));
		},
	}],
});
const { GoalProgressSync } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

function fixture() {
	const files = new Map();
	const caches = new Map();
	const events = new Map();
	const writes = [];
	const hooks = {};
	const emit = (name, ...args) => { for (const handler of events.get(name) ?? []) handler(...args); };
	const inlineTags = content => content.split(/\r?\n/).flatMap((line, number) =>
		[...line.matchAll(/#[\p{L}\p{N}_/-]+/gu)].map(match => ({ tag: match[0], position: {
			start: { line: number, col: match.index }, end: { line: number, col: match.index + match[0].length },
		} })));
	function add(path, properties = {}, content = '') {
		const file = { path, basename: path.split('/').at(-1).replace(/\.md$/, ''), properties, content };
		files.set(path, file);
		caches.set(path, { frontmatter: properties, tags: inlineTags(content) });
		return file;
	}
	const app = {
		vault: {
			getMarkdownFiles: () => [...files.values()],
			cachedRead: async file => { await hooks.beforeRead?.(file); return file.content; },
			on(name, handler) { const handlers = events.get(name) ?? []; handlers.push(handler); events.set(name, handlers); return handler; },
		},
		metadataCache: {
			getFileCache: file => caches.get(file.path) ?? null,
			getFirstLinkpathDest(linkpath) {
				return files.get(linkpath.endsWith('.md') ? linkpath : `${linkpath}.md`) ??
					[...files.values()].find(file => file.basename === linkpath) ?? null;
			},
			on(name, handler) { const handlers = events.get(name) ?? []; handlers.push(handler); events.set(name, handlers); return handler; },
		},
		fileManager: {
			async processFrontMatter(file, update) {
				writes.push(file.path);
				await hooks.beforeWrite?.(file);
				const next = structuredClone(file.properties);
				update(next);
				if (JSON.stringify(next) !== JSON.stringify(file.properties)) {
					file.properties = next;
					caches.get(file.path).frontmatter = next;
					emit('changed', file);
				}
			},
		},
	};
	const plugin = { app: { workspace: { onLayoutReady: callback => callback() } }, register() {}, registerEvent() {} };
	const idle = () => new Promise(resolve => setImmediate(resolve));
	return { add, app, caches, emit, files, hooks, idle, plugin, writes, sync: new GoalProgressSync(app) };
}

test('saves rounded numeric progress on whole-note goals and preserves unrelated properties', async () => {
	const f = fixture();
	const root = f.add('Financial Independence.md', { tags: ['goal'], custom: 'keep' });
	const freelancer = f.add('Freelancer.md', { tags: ['goal'], parent: '[[Financial Independence]]' });
	const creator = f.add('Creator.md', { tags: ['goal'], parent: '[[Financial Independence]]' });
	f.add('Registration.md', { tags: ['project', 'ready'], progress: 25, parent: '[[Freelancer]]' });
	const followers = f.add('Followers.md', { tags: ['project', 'completed'], parent: '[[Creator]]', custom: 'keep' });
	await f.sync.reconcile();
	assert.equal(root.properties.progress, 63);
	assert.equal(freelancer.properties.progress, 25);
	assert.equal(creator.properties.progress, 100);
	assert.deepEqual(root.properties, { tags: ['goal'], custom: 'keep', progress: 63 });
	assert.equal(followers.properties.progress, 100);
	assert.equal(followers.properties.custom, 'keep');
	assert.equal(f.writes.length, 4);
	await f.sync.reconcile();
	assert.equal(f.writes.length, 4);
});

test('project percentage changes update goal progress while the Goals view is closed', async () => {
	const f = fixture();
	const goal = f.add('Goal.md', { tags: ['goal'] });
	const project = f.add('Project.md', { tags: ['project', 'ready'], progress: 25, parent: '[[Goal]]' });
	f.sync.start(f.plugin);
	await f.idle();
	assert.equal(goal.properties.progress, 25);
	project.properties.tags = ['project', 'doing'];
	f.emit('changed', project);
	await f.idle();
	assert.equal(goal.properties.progress, 25);
	project.properties.progress = 50;
	f.emit('changed', project);
	await f.idle();
	assert.equal(goal.properties.progress, 50);
	project.properties.tags = ['project', 'completed'];
	f.emit('changed', project);
	await f.idle();
	assert.equal(project.properties.progress, 100);
	assert.equal(goal.properties.progress, 100);
	project.properties.parent = '[[Unrelated]]';
	f.emit('changed', project);
	await f.idle();
	assert.equal(goal.properties.progress, 0);
	goal.properties.progress = 99;
	f.emit('changed', goal);
	await f.idle();
	assert.equal(goal.properties.progress, 0);
	assert.equal(f.writes.filter(path => path === goal.path).length, 5);
});

test('missing or invalid manual project progress contributes zero until completion', async () => {
	const f = fixture();
	const goal = f.add('Goal.md', { tags: ['goal'] });
	const project = f.add('Project.md', { tags: ['project', 'doing'], parent: '[[Goal]]' });
	await f.sync.reconcile();
	assert.equal(goal.properties.progress, 0);
	assert.equal(project.properties.progress, undefined);
	project.properties.progress = '85%';
	await f.sync.reconcile();
	assert.equal(goal.properties.progress, 0);
	assert.equal(project.properties.progress, '85%');
	project.properties.tags = ['project', 'completed'];
	await f.sync.reconcile();
	assert.equal(project.properties.progress, 100);
	assert.equal(goal.properties.progress, 100);
});

test('completed project progress is restored after a manual edit below 100', async () => {
	const f = fixture();
	const goal = f.add('Goal.md', { tags: ['goal'] });
	const project = f.add('Project.md', { tags: ['project', 'completed'], progress: 85, parent: '[[Goal]]' });
	f.sync.start(f.plugin);
	await f.idle();
	assert.equal(project.properties.progress, 100);
	assert.equal(goal.properties.progress, 100);
	project.properties.progress = 80;
	f.emit('changed', project);
	await f.idle();
	assert.equal(project.properties.progress, 100);
	assert.equal(f.writes.filter(path => path === project.path).length, 2);
});

test('reopening a completed project keeps its saved 100 until edited', async () => {
	const f = fixture();
	const goal = f.add('Goal.md', { tags: ['goal'] });
	const project = f.add('Project.md', { tags: ['project', 'completed'], progress: 85, parent: '[[Goal]]' });
	await f.sync.reconcile();
	assert.equal(project.properties.progress, 100);
	project.properties.tags = ['project', 'doing'];
	await f.sync.reconcile();
	assert.equal(goal.properties.progress, 100);
	project.properties.progress = 60;
	await f.sync.reconcile();
	assert.equal(goal.properties.progress, 60);
});

test('inline goals do not create a shared frontmatter progress property', async () => {
	const f = fixture();
	const source = f.add('Notes.md', { tags: ['area'], custom: 7 }, '- First #goal\n- Second #goal');
	const unrelated = f.add('Other.md', { tags: ['area'], progress: 42 });
	await f.sync.reconcile();
	assert.deepEqual(source.properties, { tags: ['area'], custom: 7 });
	assert.equal(unrelated.properties.progress, 42);
	assert.deepEqual(f.writes, []);
});

test('a removed goal tag is rechecked at write time', async () => {
	const f = fixture();
	const goal = f.add('Goal.md', { tags: ['goal'] });
	f.hooks.beforeWrite = file => {
		file.properties.tags = ['area'];
		f.caches.get(file.path).frontmatter = file.properties;
	};
	await f.sync.reconcile();
	assert.equal(goal.properties.progress, undefined);
});

test('publishes the canonical raw snapshot and own schedule without a second percentage formula', async () => {
	const f = fixture(); const published = [];
	const goal = f.add('Goal.md', { tags: ['goal'], 'start date': '2026-10-01', deadline: '2026-10-14' });
	f.add('Project.md', { tags: ['project', 'doing'], progress: 50, parent: '[[Goal]]' });
	const sync = new GoalProgressSync(f.app, goals => published.push(goals));
	await sync.reconcile();
	assert.equal(published[0][0].progress, 50);
	assert.equal(published[0][0].started, 1); assert.equal(published[0][0].completed, 0);
	assert.equal(published[0][0].start, '2026-10-01');
	goal.properties.deadline = '2026-11-01';
	await sync.reconcile(); assert.equal(published[1][0].deadline, '2026-11-01');
	assert.equal(f.writes.length, 1);
});

test('inline goal snapshots retain exact source identity without writing shared progress', async () => {
	const f = fixture(); const published = [];
	f.add('Source.md', { tags: ['area'], deadline: '2026-10-14' }, '- Actual goal #goal');
	const sync = new GoalProgressSync(f.app, goals => published.push(goals));
	await sync.reconcile();
	assert.deepEqual(published[0][0].identity, { path: 'Source.md', line: 0, sourceLine: '- Actual goal #goal' });
	assert.equal(published[0][0].deadline, '2026-10-14'); assert.deepEqual(f.writes, []);
});

test('metadata changes invalidate a slow snapshot before the debounced refresh runs', async t => {
	const f = fixture(); const published = []; let release;
	const goal = f.add('Goal.md', { tags: ['goal'] }, '- Work #project #doing');
	f.hooks.beforeRead = () => new Promise(resolve => { release = resolve; });
	globalThis.horizonTestRefreshQueue = [];
	t.after(() => { delete globalThis.horizonTestRefreshQueue; });
	const sync = new GoalProgressSync(f.app, goals => published.push(goals));
	sync.start(f.plugin); globalThis.horizonTestRefreshQueue.shift()();
	await f.idle(); assert.ok(release);
	f.emit('changed', goal); f.hooks.beforeRead = undefined; release(); await f.idle();
	assert.equal(published.length, 0); assert.deepEqual(f.writes, []);
	globalThis.horizonTestRefreshQueue.shift()(); await f.idle();
	assert.equal(published.length, 1); assert.equal(published[0][0].progress, 50);
});
