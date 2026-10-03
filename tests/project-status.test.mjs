import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
const { transformSync } = createRequire(import.meta.url)('esbuild');
const source = fs.readFileSync(new URL('../src/ui/project-status.ts', import.meta.url), 'utf8');
const code = transformSync(source, { loader: 'ts', format: 'esm' }).code;
const { PROJECT_STATUSES, setProjectStatus, setLineStatus, projectStatusForTags } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

function appFor(frontmatter = {}, content = '') {
	const file = { path: 'Work.md' };
	const calls = [];
	const state = { content, frontmatter };
	return { file, state, calls, app: {
		vault: {
			getFileByPath: path => path === file.path ? file : null,
			async process(target, fn) { assert.equal(target, file); calls.push('process'); state.content = fn(state.content); return state.content; },
		},
		fileManager: {
			async processFrontMatter(target, fn) { assert.equal(target, file); calls.push('frontmatter'); fn(state.frontmatter); },
		},
	} };
}

test('menu statuses have the exact requested order and a placeholder icon each', () => {
	assert.deepEqual(PROJECT_STATUSES.map(status => status.tag), ['todo', 'backburner', 'waiting', 'discuss', 'ready', 'doing', 'completed']);
	assert.ok(PROJECT_STATUSES.every(status => status.icon));
	assert.deepEqual(PROJECT_STATUSES.map(status => status.icon), ['circle-small', 'circle-dashed', 'clock', 'at-sign', 'circle', 'circle-slash', 'circle-check-big']);
});

test('untagged and legacy todo projects have the default icon; explicit statuses select their own icons', () => {
	for (const tags of [[], ['#project'], ['#todo', '#project'], ['#doing/later']]) {
		assert.equal(projectStatusForTags(tags).icon, 'circle-small');
	}
	for (const status of PROJECT_STATUSES) {
		assert.equal(projectStatusForTags(['#project', '#'+status.tag.toUpperCase()]).icon, status.icon);
	}
	assert.equal(projectStatusForTags(['todo', 'waiting', 'completed']).icon, 'circle-check-big');
});

test('choosing todo clears only exact status tags and never adds todo to note properties', async () => {
	const { app, state } = appFor({ tags: ['project', '#TODO', 'doing', 'client', 'waiting/approval'], parent: '[[Work]]' });
	await setProjectStatus(app, { path: 'Work.md' }, 'todo');
	await setProjectStatus(app, { path: 'Work.md' }, 'todo');
	assert.deepEqual(state.frontmatter, { tags: ['project', 'client', 'waiting/approval'], parent: '[[Work]]' });
	assert.equal(projectStatusForTags(state.frontmatter.tags).icon, 'circle-small');
	const empty = appFor();
	await setProjectStatus(empty.app, { path: 'Work.md' }, 'todo');
	assert.deepEqual(empty.state.frontmatter.tags, []);
});

test('choosing todo on an inline project clears status tags without altering other lines or code', () => {
	const raw = '  - Build #project #TODO #doing #client `#waiting`  ';
	const updated = setLineStatus(raw+'\r\nOther #completed', { line: 0, sourceLine: raw }, 'todo');
	assert.equal(updated, '  - Build #project #client `#waiting`  \r\nOther #completed');
	const plain = '- Build #project #client';
	assert.equal(setLineStatus(plain, { line: 0, sourceLine: plain }, 'todo'), plain);
});

test('switching an inline status replaces old statuses while preserving nested tags and task syntax', () => {
	const raw = '- [ ] Build #project #backburner #waiting #waiting/later #client';
	const updated = setLineStatus(raw, { line: 0, sourceLine: raw }, 'doing');
	assert.equal(updated, '- [ ] Build #project #waiting/later #client #doing');
	assert.equal(setLineStatus(updated, { line: 0, sourceLine: updated }, 'doing'), updated);
});

test('whole-note selection uses native frontmatter processing and preserves existing properties and tags', async () => {
	const { app, state, calls } = appFor({ tags: ['project', 'client'], parent: '[[Work]]', dependent: '[[Other]]', custom: 7 }, 'Note content');
	await setProjectStatus(app, { path: 'Work.md' }, 'doing');
	assert.deepEqual(state.frontmatter, { tags: ['project', 'client', 'doing'], parent: '[[Work]]', dependent: '[[Other]]', custom: 7 });
	assert.equal(state.content, 'Note content');
	assert.deepEqual(calls, ['frontmatter']);
});

test('note tags support absent, string and list properties; repeats do not duplicate', async () => {
	for (const tags of [undefined, null, '', 'project, client', ['project', '#READY']]) {
		const { app, state } = appFor({ tags });
		await setProjectStatus(app, { path: 'Work.md' }, 'ready');
		await setProjectStatus(app, { path: 'Work.md' }, 'ready');
		assert.equal(state.frontmatter.tags.filter(tag => tag.replace(/^#/, '').toLowerCase() === 'ready').length, 1);
		if (tags?.length) assert.ok(state.frontmatter.tags.includes('project'));
	}
});

test('malformed note tags fail without overwriting the property', async () => {
	for (const tags of [false, 42, { client: true }, ['project', 7]]) {
		const { app, state } = appFor({ tags });
		await assert.rejects(setProjectStatus(app, { path: 'Work.md' }, 'ready'), /not a text value or list/);
		assert.deepEqual(state.frontmatter.tags, tags);
	}
});

test('inline selection updates only the specified project line, preserving CRLF, Unicode and hard-break spaces', async () => {
	const raw = '- [ ] 💼 build #project #client  ';
	const { app, state, calls } = appFor({ tags: ['area'] }, `---\r\ntags: [area]\r\n---\r\n${raw}\r\n- another #project\r\n`);
	await setProjectStatus(app, { path: 'Work.md', line: 3, sourceLine: raw }, 'waiting');
	assert.equal(state.content, `---\r\ntags: [area]\r\n---\r\n- [ ] 💼 build #project #client #waiting  \r\n- another #project\r\n`);
	assert.deepEqual(state.frontmatter.tags, ['area']);
	assert.deepEqual(calls, ['process']);
});

test('an existing status is not duplicated, while nested tags and literal code do not block an exact status', () => {
	for (const raw of ['Build #project #READY', 'Build #project (#ready)']) {
		assert.equal(setLineStatus(raw, { line: 0, sourceLine: raw }, 'ready'), raw);
	}
	for (const raw of ['Build #project #ready/later', 'Build #project #readys', 'Build #project `#ready`']) {
		assert.equal(setLineStatus(raw, { line: 0, sourceLine: raw }, 'ready'), `${raw} #ready`);
	}
});

test('switching status replaces earlier statuses and keeps unrelated tags', async () => {
	const { app, state } = appFor({ tags: ['project', 'todo', 'client'] });
	await setProjectStatus(app, { path: 'Work.md' }, 'completed');
	assert.deepEqual(state.frontmatter.tags, ['project', 'client', 'completed']);
});

test('a uniquely moved source line is found in current content; concurrent changes elsewhere survive', () => {
	const raw = '- Build #project';
	assert.equal(setLineStatus(`New introduction\n${raw}\nChanged elsewhere`, { line: 0, sourceLine: raw }, 'ready'), `New introduction\n${raw} #ready\nChanged elsewhere`);
});

test('stale, removed, ambiguous and invalid line targets fail rather than change another item', () => {
	const raw = '- Build #project';
	for (const content of ['Changed #project', 'Other\n'+raw+'\n'+raw]) {
		assert.throws(() => setLineStatus(content, { line: 0, sourceLine: raw }, 'doing'), /line changed/);
	}
	for (const line of [-1, 0.5, NaN]) assert.throws(() => setLineStatus(raw, { line, sourceLine: raw }, 'doing'), /Invalid project line/);
	assert.throws(() => setLineStatus(raw, { line: 0 }, 'doing'), /Invalid project line/);
});

test('missing files and unknown menu statuses cannot write', async () => {
	const { app, calls } = appFor();
	await assert.rejects(setProjectStatus(app, { path: 'Missing.md' }, 'todo'), /no longer exists/);
	await assert.rejects(setProjectStatus(app, { path: 'Work.md' }, 'unknown'), /Unknown project status/);
	assert.deepEqual(calls, []);
});
