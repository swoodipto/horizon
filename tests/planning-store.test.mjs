import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/planning/store.ts', import.meta.url))], bundle: true, write: false, format: 'esm', plugins: [{
	name: 'mock-obsidian', setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test' }));
		// The stub serializes properties as JSON so this harness can inspect writes without a YAML dependency.
		build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const stringifyYaml = value => JSON.stringify(value, null, 2);', loader: 'js' }));
	},
}] });
const { PlanningStore } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

function fixture() {
	const files = new Map();
	const caches = new Map();
	const calls = [];
	const hooks = {};
	function add(path, properties = {}, content = '', tags) {
		const file = { path, basename: path.split('/').at(-1).replace(/\.md$/, ''), parent: { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' }, content, properties };
		files.set(path, file);
		caches.set(path, { frontmatter: properties, tags: tags ?? inlineTags(content) });
		return file;
	}
	function inlineTags(content) {
		return content.split(/\r?\n/).flatMap((line, number) => [...line.matchAll(/#[\p{L}\p{N}_/-]+/gu)].map(match => ({ tag: match[0], position: { start: { line: number, col: match.index }, end: { line: number, col: match.index + match[0].length } } })));
	}
	const app = {
		vault: {
			getMarkdownFiles: () => [...files.values()],
			getFileByPath: path => files.get(path) ?? null,
			getAbstractFileByPath: path => files.get(path) ?? null,
			async cachedRead(file) { calls.push(['cachedRead', file.path]); return file.content; },
			async read(file) { calls.push(['read', file.path]); return file.content; },
			async create(path, content) {
				calls.push(['create', path]);
				await hooks.beforeCreate?.(path, content);
				if (files.has(path)) throw new Error('File already exists');
				const properties = JSON.parse(content.slice(4, content.lastIndexOf('\n---')));
				const file = add(path, properties, content, []);
				await hooks.afterCreate?.(file);
				return file;
			},
			async process(file, update) {
				calls.push(['process', file.path]);
				await hooks.beforeProcess?.(file);
				file.content = update(file.content);
				if (!hooks.keepStaleTags) caches.get(file.path).tags = inlineTags(file.content);
				return file.content;
			},
		},
		metadataCache: {
			getFileCache: file => caches.get(file.path) ?? null,
			getFirstLinkpathDest: (linkpath, source) => {
				const path = linkpath.replace(/\.md$/, '') + '.md';
				const local = source.includes('/') ? source.slice(0, source.lastIndexOf('/') + 1) + path : path;
				return files.get(path) ?? files.get(local) ?? [...files.values()].find(file => file.basename === linkpath) ?? null;
			},
		},
		fileManager: {
			async processFrontMatter(file, update) {
				calls.push(['frontmatter', file.path]);
				await hooks.beforeFrontmatter?.(file);
				const next = structuredClone(file.properties);
				update(next);
				file.properties = next;
				caches.get(file.path).frontmatter = next;
			},
			async trashFile(file) { calls.push(['trash', file.path]); files.delete(file.path); caches.delete(file.path); },
		},
	};
	return { app, add, files, caches, calls, hooks, store: new PlanningStore(app) };
}

test('discovery supports canonical/alias/nested project property tags and reads only inline candidates', async () => {
	const f = fixture();
	f.add('A.md', { tags: 'project', 'start date': '2026-10-05' }, 'Body');
	f.add('B.md', { tags: ['PROJECTS/client'], deadline: '2026-10-10', title: 'Client work' });
	f.add('Area.md', { tags: ['area'] }, 'Home');
	f.add('Inline.md', {}, '- Build #project\r\n- Launch #projects #ready\r\n- Later #projects/2026');
	const projects = await f.store.load();
	assert.equal(projects.length, 5);
	assert.equal(projects.find(project => project.path === 'B.md').title, 'Client work');
	assert.equal(projects.find(project => project.inline?.line === 1).status, 'ready');
	assert.ok(projects.filter(project => project.inline).every(project => !project.start && !project.deadline));
	assert.deepEqual(f.calls, [['cachedRead', 'Inline.md']]);
});

test('date-only saves preserve unrelated YAML and dependency syntax; cleared fields are removed', async () => {
	const f = fixture();
	const original = { tags: ['project', 'client'], title: 'Important', 'start date': '2026-10-05', deadline: '2026-10-10', dependent: '[[Folder/Missing|Alias]]', parent: ['[[Area]]'], custom: { value: 7 } };
	const file = f.add('A.md', structuredClone(original), 'Unchanged body');
	const [project] = await f.store.load();
	const saved = await f.store.saveDates(project, { deadline: '2026-10-12' });
	const expected = { ...original, deadline: '2026-10-12' }; delete expected['start date'];
	assert.deepEqual(file.properties, expected);
	assert.ok(!Object.hasOwn(file.properties, 'start date'));
	assert.equal(file.content, 'Unchanged body');
	assert.equal(saved.start, undefined);
	assert.equal(saved.deadline, '2026-10-12');
	const cleared = await f.store.saveDates(saved, {});
	assert.equal(cleared.deadline, undefined);
	assert.ok(!Object.hasOwn(file.properties, 'deadline'));
});

test('invalid and reversed date writes fail before a mutation', async () => {
	const f = fixture(); f.add('A.md', { tags: ['project'] });
	const [project] = await f.store.load();
	for (const dates of [{ start: '' }, { deadline: '2026-02-30' }, { start: '2026-10-10', deadline: '2026-10-05' }]) {
		await assert.rejects(f.store.saveDates(project, dates), /valid|before/);
	}
	assert.deepEqual(f.calls, []);
});

test('invalid existing dates are reported and can be fixed intentionally', async () => {
	const f = fixture(); f.add('A.md', { tags: ['project'], 'start date': 'not-a-date', deadline: new Date('2026-10-10T00:00:00Z') });
	const [project] = await f.store.load();
	assert.deepEqual(project.invalidDates, ['start']);
	assert.equal(project.deadline, '2026-10-10');
	const saved = await f.store.saveDates(project, { start: '2026-10-05', deadline: project.deadline });
	assert.equal(saved.invalidDates, undefined);
});

test('savePlan keeps unresolved folder links and writes selected known links without touching other fields', async () => {
	const f = fixture();
	const file = f.add('A.md', { tags: ['project'], dependent: ['[[Missing/Project|Label]]', 'Missing/Other'], custom: 7 });
	f.add('Known.md', { tags: ['project'] });
	const project = (await f.store.load()).find(item => item.path === 'A.md');
	assert.deepEqual(project.dependencies.map(dependency => dependency.linkpath), ['Missing/Project', 'Missing/Other']);
	const saved = await f.store.savePlan(project, { start: '2026-10-05' }, [...project.dependencies.map(dep => dep.path ?? dep.linkpath), 'Known.md']);
	assert.deepEqual(file.properties.dependent, ['[[Missing/Project]]', '[[Missing/Other]]', '[[Known]]']);
	assert.equal(file.properties.custom, 7);
	assert.equal(saved.dependencies.find(dep => dep.title === 'Known').path, 'Known.md');
	await f.store.savePlan(saved, {}, []);
	assert.ok(!Object.hasOwn(file.properties, 'dependent'));
});

test('stale dates/dependencies reject at metadata preflight and inside the atomic YAML callback', async () => {
	for (const field of ['start date', 'dependent']) {
		const f = fixture(); const file = f.add('A.md', { tags: ['project'], 'start date': '2026-10-05' });
		const [project] = await f.store.load();
		file.properties[field] = field === 'start date' ? '2026-10-06' : '[[Changed]]';
		await assert.rejects(f.store.saveDates(project, { deadline: '2026-10-10' }), /plan changed/);
		assert.ok(!Object.hasOwn(file.properties, 'deadline'));
		assert.deepEqual(f.calls, []);
	}
	const f = fixture(); const file = f.add('A.md', { tags: ['project'], 'start date': '2026-10-05' });
	const [project] = await f.store.load();
	f.hooks.beforeFrontmatter = note => { note.properties = { ...note.properties, dependent: '[[Changed during save]]' }; };
	await assert.rejects(f.store.saveDates(project, { deadline: '2026-10-10' }), /plan changed/);
	assert.equal(file.properties.dependent, '[[Changed during save]]');
	assert.ok(!Object.hasOwn(file.properties, 'deadline'));
});

test('new project creation validates title and writes dates/dependencies in one local note', async () => {
	const f = fixture();
	const created = await f.store.create('Build: website', { deadline: '2026-10-10' }, ['Future/Project']);
	assert.equal(created.path, 'Build- website.md');
	assert.equal(created.title, 'Build: website');
	assert.deepEqual(f.files.get(created.path).properties, { tags: ['project'], deadline: '2026-10-10', dependent: ['[[Future/Project]]'], title: 'Build: website' });
	assert.equal(f.calls.filter(([name]) => name === 'create').length, 1);
	await assert.rejects(f.store.create('  ', {}), /title/);
});

test('inline promotion creates a sibling with exact display title/status/parent and replaces project markers only', async () => {
	const f = fixture();
	const raw = '  - [ ] Build #project #projects/2026 #client #doing  ';
	const source = f.add('Work/Plans.md', {}, `Intro\r\n${raw}\r\nOther copy\r\n`);
	const [project] = await f.store.load();
	const promoted = await f.store.savePlan(project, { start: '2026-10-05', deadline: '2026-10-10' }, ['Other.md']);
	assert.equal(promoted.inline, undefined);
	assert.equal(promoted.title, 'Build #client #doing');
	assert.match(promoted.path, /^Work\/Build -client -doing\.md$/);
	assert.deepEqual(f.files.get(promoted.path).properties.tags, ['project', 'doing']);
	assert.equal(f.files.get(promoted.path).properties.parent, '[[Work/Plans]]');
	assert.equal(f.files.get(promoted.path).properties.title, project.title);
	assert.equal(source.content, `Intro\r\n  - [ ] Build [[Work/Build -client -doing|Build #client #doing]]  #client #doing  \r\nOther copy\r\n`);
	assert.equal((await f.store.load()).filter(item => item.inline).length, 0);
});

test('filename collision adds a suffix and keeps the original title; creation races retry safely', async () => {
	const f = fixture(); f.add('Work/Build.md', {});
	f.add('Work/Plans.md', {}, '- Build #project');
	const [project] = await f.store.load();
	let raced = false;
	f.hooks.beforeCreate = path => { if (!raced) { raced = true; f.add(path, {}, 'Existing concurrent note'); } };
	const saved = await f.store.saveDates(project, { deadline: '2026-10-10' });
	assert.equal(saved.path, 'Work/Build 3.md');
	assert.equal(saved.title, 'Build');
	assert.equal(f.files.get('Work/Build 2.md').content, 'Existing concurrent note');
	assert.equal(f.files.get(saved.path).properties.title, 'Build');
});

test('promotion rejects missing dates, edited lines and ambiguous source lines before creating notes', async () => {
	for (const changed of ['- Changed #project', '- Build #project\n- Build #project']) {
		const f = fixture(); const file = f.add('Plans.md', {}, '- Build #project');
		const [project] = await f.store.load(); file.content = changed;
		await assert.rejects(f.store.saveDates(project, { start: '2026-10-05' }), /line changed/);
		assert.equal(f.files.size, 1);
		assert.equal(f.calls.filter(([name]) => name === 'create').length, 0);
	}
	const f = fixture(); f.add('Plans.md', {}, '- Build #project');
	const [project] = await f.store.load();
	await assert.rejects(f.store.saveDates(project, {}), /at least one date/);
	assert.deepEqual(f.calls, [['cachedRead', 'Plans.md']]);
});

test('a uniquely moved inline line promotes successfully while preserving other concurrent changes', async () => {
	const f = fixture(); const file = f.add('Plans.md', {}, '- Build #project\nOther');
	const [project] = await f.store.load(); file.content = 'New intro\n- Build #project\nChanged elsewhere';
	await f.store.saveDates(project, { start: '2026-10-05' });
	assert.equal(file.content, 'New intro\n- Build [[Build]]\nChanged elsewhere');
});

test('source changes after creation roll back the untouched new note and preserve the edited source', async () => {
	const f = fixture(); const source = f.add('Plans.md', {}, '- Build #project');
	const [project] = await f.store.load();
	f.hooks.beforeProcess = file => { file.content = '- Changed by another writer #project'; };
	await assert.rejects(f.store.saveDates(project, { start: '2026-10-05' }), /line changed/);
	assert.equal(f.files.size, 1);
	assert.equal(source.content, '- Changed by another writer #project');
	assert.ok(f.calls.some(([name, path]) => name === 'trash' && path === 'Build.md'));
});

test('rollback keeps a newly created note when another writer changed its content', async () => {
	const f = fixture(); f.add('Plans.md', {}, '- Build #project');
	const [project] = await f.store.load();
	f.hooks.afterCreate = file => { file.content += 'Added by someone else\n'; };
	f.hooks.beforeProcess = file => { file.content = '- Changed #project'; };
	await assert.rejects(f.store.saveDates(project, { start: '2026-10-05' }), /line changed/);
	assert.equal(f.files.size, 2);
	assert.match(f.files.get('Build.md').content, /Added by someone else/);
	assert.ok(!f.calls.some(([name]) => name === 'trash'));
});

test('promotion does not rediscover a source entry when the metadata cache still has old tag positions', async () => {
	const f = fixture(); f.add('Plans.md', {}, '- Build #project');
	const [project] = await f.store.load();
	f.hooks.keepStaleTags = true;
	await f.store.saveDates(project, { start: '2026-10-05' });
	assert.equal((await f.store.load()).filter(item => item.inline).length, 0);
});
