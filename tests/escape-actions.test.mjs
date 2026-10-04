import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { build } = createRequire(import.meta.url)('esbuild');
const code = (await build({
	stdin: { contents: "export * from './escape-actions';", loader: 'ts',
		resolveDir: fileURLToPath(new URL('../src/ui/', import.meta.url)) },
	bundle: true, write: false, format: 'esm', plugins: [{ name: 'mock-obsidian', setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
		build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export class Component {
			cleanups=[];
			register(fn){this.cleanups.push(fn);}
			registerDomEvent(el,type,fn,options){el.addEventListener(type,fn,options);this.register(()=>el.removeEventListener(type,fn,options));}
			unload(){this.cleanups.splice(0).forEach(fn=>fn());}
		}`, loader: 'js' }));
	} }],
})).outputFiles[0].text;
const { EscapeActions } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('Escape actions run newest first, unregister cleanly, and leave unhandled keys alone', () => {
	const doc = new EventTarget();
	const escapes = new EscapeActions(doc);
	const calls = [];
	const removeFirst = escapes.addAction(() => { calls.push('first'); return true; });
	const removeSecond = escapes.addAction(() => { calls.push('second'); return false; });
	const handled = new Event('keydown', { cancelable: true });
	handled.key = 'Escape';
	doc.dispatchEvent(handled);
	assert.deepEqual(calls, ['second', 'first']);
	assert.equal(handled.defaultPrevented, true);
	removeFirst();
	const unhandled = new Event('keydown', { cancelable: true });
	unhandled.key = 'Escape';
	doc.dispatchEvent(unhandled);
	assert.equal(unhandled.defaultPrevented, false);
	removeSecond();
	escapes.unload();
	const afterUnload = new Event('keydown', { cancelable: true });
	afterUnload.key = 'Escape';
	doc.dispatchEvent(afterUnload);
	assert.deepEqual(calls, ['second', 'first', 'second']);
});
