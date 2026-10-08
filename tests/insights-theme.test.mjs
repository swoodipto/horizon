import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const charts = css.slice(css.indexOf('/* Insights uses'), css.indexOf('.horizon-sidebar-project-heading-icon svg'));

test('Insights chart palette follows native theme tokens without light/dark overrides', () => {
	for (const [role, token] of Object.entries({ scope: 'text-faint', started: 'text-warning', completed: 'text-accent', deadline: 'text-error' })) {
		assert.ok(charts.includes(`--horizon-graph-${role}: var(--${token});`));
	}
	// The supplied card hover shadow has a fixed black tint; chart colors remain theme-native.
	const palette = charts.replace(/box-shadow:\s*[^;]+;/g, '');
	assert.doesNotMatch(palette, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
	assert.doesNotMatch(css, /\.theme-(?:light|dark)\s+\.horizon-insights-card/);
});

test('Insights typography uses native interface font, UI sizes and line heights', () => {
	const typography = [...charts.matchAll(/(?:font-family|font-size|font-weight|line-height):\s*([^;]+);/g)];
	assert.ok(typography.length > 0);
	for (const [, value] of typography) assert.match(value, /^var\(--(?:(?:font|line-height)-[\w-]+|inline-title-(?:size|weight))\)$/);
	assert.match(charts, /\.horizon-pace-tick\s*\{[^}]*font-size: var\(--font-ui-smaller\)/);
	assert.match(charts, /\.horizon-insights-goal\s*\{[^}]*font-family: var\(--font-interface\)/);
});

test('Chart strokes and legend samples use native sizing tokens', () => {
	assert.match(charts, /stroke-width: var\(--icon-stroke\)/);
	assert.match(charts, /\.horizon-pace-legend span::before\s*\{[^}]*width: var\(--size-4-4\)/);
});
