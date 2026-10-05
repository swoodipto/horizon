import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { build } = createRequire(import.meta.url)('esbuild');
const code = (await build({
	stdin: { contents: "export * from './option-shortcuts';", loader: 'ts',
		resolveDir: fileURLToPath(new URL('../src/ui/', import.meta.url)) },
	bundle: true, write: false, format: 'esm', plugins: [{ name: 'mock-obsidian', setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
		build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
			contents: 'export const addIcon = () => {}; export const removeIcon = () => {}; export class Plugin {}',
			loader: 'js',
		}));
	} }],
})).outputFiles[0].text;
const { buildOptionShortcuts, OPTION_SHORTCUTS, shortcutForOption, optionForShortcut } =
	await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const option = (id, label, shortcut) => ({ id, label, icon: 'test', shortcut });
const keys = options => buildOptionShortcuts(options).map(({ option, key }) => [option.id, key]);

test('current options share one structured shortcut mapping and preserve the Areas ID', () => {
	assert.deepEqual(OPTION_SHORTCUTS.map(({ option, key }) => [option.id, key]), [
		['life-areas', 'a'], ['goals', 'g'], ['projects', 'p'],
		['insights', 'i'], ['upcoming', 'u'], ['timeline', 't'],
	]);
	assert.equal(optionForShortcut('a').label, 'Areas');
	assert.equal(optionForShortcut('a').id, 'life-areas');
	for (const { option, key } of OPTION_SHORTCUTS) {
		assert.equal(shortcutForOption(option.id), key);
		assert.equal(optionForShortcut(key), option);
	}
});

test('a future option automatically uses its second letter when its first is taken', () => {
	assert.deepEqual(keys([option('projects', 'Projects'), option('plans', 'Plans')]), [
		['projects', 'p'], ['plans', 'l'],
	]);
});

test('inserting a future option before established options preserves their keys and output order', () => {
	const existing = OPTION_SHORTCUTS.map(({ option }) => option);
	assert.deepEqual(keys([option('project-plans', 'Project plans'), ...existing]), [
		['project-plans', 'r'],
		['life-areas', 'a'], ['goals', 'g'], ['projects', 'p'],
		['insights', 'i'], ['upcoming', 'u'], ['timeline', 't'],
	]);
});

test('explicit keys are case insensitive and invalid or conflicting reservations use label fallbacks', () => {
	assert.deepEqual(keys([
		option('plans', 'Plans', 'P'), option('projects', 'Projects', 'p'),
		option('goals', 'Goals', '?'), option('areas', 'Areas', 'AB'),
		option('upcoming', 'Upcoming', ' u '),
	]), [['plans', 'p'], ['projects', 'r'], ['goals', 'g'], ['areas', 'a'], ['upcoming', 'u']]);
});

test('multiple collisions advance through label letters in definition order', () => {
	const options = [option('first', 'Projects'), option('second', 'Labels'), option('third', 'Plans')];
	assert.deepEqual(keys(options), [['first', 'p'], ['second', 'l'], ['third', 'a']]);
	assert.deepEqual(keys([...options, option('fourth', 'PLANS')]), [
		['first', 'p'], ['second', 'l'], ['third', 'a'], ['fourth', 'n'],
	]);
});

test('spaces, punctuation, case and repeated letters do not consume extra keys', () => {
	assert.deepEqual(keys([option('first', '... P!'), option('second', 'p-p P-lans')]), [
		['first', 'p'], ['second', 'l'],
	]);
});

test('labels without an available letter are omitted without inventing a shortcut', () => {
	assert.deepEqual(keys([
		option('empty', ''), option('punctuation', '123 ! ?'),
		option('first', 'AA'), option('exhausted', 'a-a A'), option('later', 'B'),
	]), [['first', 'a'], ['later', 'b']]);
});

test('lookup matches uppercase and lowercase keys and safely ignores missing options', () => {
	assert.equal(optionForShortcut('A'), optionForShortcut('a'));
	assert.equal(optionForShortcut('G'), optionForShortcut('g'));
	assert.equal(optionForShortcut(' '), undefined);
	assert.equal(optionForShortcut('ArrowDown'), undefined);
	assert.equal(shortcutForOption('missing'), undefined);
});
