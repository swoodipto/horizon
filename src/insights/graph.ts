import { Component } from 'obsidian';
import { today } from '../planning/dates';
import { formatInsightDate } from './format';
import { graphLayout, type GraphPoint } from './graph-layout';
import { goalForecast } from './forecast';
import { completionBarGeometry } from './completion-bars';
import type { Completion } from './history';

const NS = 'http://www.w3.org/2000/svg';
let nextGraph = 0;
type Forecast = ReturnType<typeof goalForecast>;

/** SVG geometry is decorative; its shared selection is also exposed as readable text. */
export class GoalGraph extends Component {
	private svg: SVGSVGElement;
	private tooltip: HTMLElement;
	private points: readonly GraphPoint[] = [];
	private completions: readonly Completion[] = [];
	private forecast: Forecast = { kind: 'unavailable', message: '' };
	private layout: ReturnType<typeof graphLayout> | undefined;
	private selection = -1;
	private forecastSelected = false;
	private overlay: SVGElement | undefined;
	private touch: { x: number; y: number; cancelled: boolean } | undefined;
	private visible = false;
	private id = `horizon-insights-${nextGraph++}`;

	constructor(private root: HTMLElement) {
		super();
		root.classList.add('horizon-insights-plot');
		root.tabIndex = 0;
		root.setAttribute('role', 'group');
		root.setAttribute('aria-label', 'Progress graph. Use left and right arrows to inspect observations; Escape clears selection.');
		root.dataset.focusRole = 'graph';
		this.svg = root.ownerDocument.createElementNS(NS, 'svg');
		this.svg.setAttribute('aria-hidden', 'true');
		root.appendChild(this.svg);
		this.tooltip = root.createDiv({ cls: 'horizon-insights-tooltip', attr: { 'role': 'status', 'aria-live': 'polite' } });
		this.tooltip.hidden = true;
		this.registerDomEvent(root, 'pointerdown', event => {
			if (event.pointerType === 'touch') this.touch = { x: event.clientX, y: event.clientY, cancelled: false };
		});
		this.registerDomEvent(root, 'pointermove', event => {
			if (event.pointerType === 'touch') {
				if (this.touch && Math.hypot(event.clientX - this.touch.x, event.clientY - this.touch.y) > 6) {
					this.touch.cancelled = true; this.hideSelection();
				}
				return;
			}
			this.selectX(event.clientX);
		});
		this.registerDomEvent(root, 'pointerup', event => {
			if (event.pointerType === 'touch' && this.touch && !this.touch.cancelled) this.selectX(event.clientX);
			this.touch = undefined;
		});
		this.registerDomEvent(root, 'pointercancel', () => { this.touch = undefined; this.hideSelection(); });
		this.registerDomEvent(root, 'pointerleave', event => { if (event.pointerType !== 'touch') this.hideSelection(); });
		this.registerDomEvent(root, 'blur', () => this.hideSelection());
		this.registerDomEvent(root, 'keydown', event => {
			if (event.target !== root || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
			if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
			event.preventDefault(); event.stopPropagation();
			if (event.key === 'Escape') { this.hideSelection(); return; }
			const last = this.layout?.samples.length ? this.layout.samples.length - 1 : -1;
			this.forecastSelected = false;
			this.selection = event.key === 'Home' ? 0 : event.key === 'End' ? last
				: Math.max(0, Math.min(last, this.selection < 0 ? last : this.selection + (event.key === 'ArrowRight' ? 1 : -1)));
			this.showSelection();
		});
		const resize = new ResizeObserver(() => { if (this.visible) this.render(); });
		resize.observe(root);
		this.register(() => resize.disconnect());
		if (typeof IntersectionObserver !== 'undefined') {
			const observer = new IntersectionObserver(entries => {
				this.visible = entries.some(entry => entry.isIntersecting);
				if (this.visible) this.render();
			}, { rootMargin: '160px' });
			observer.observe(root);
			this.register(() => observer.disconnect());
		} else this.visible = true;
	}

	update(points: readonly GraphPoint[], forecast: Forecast, completions: readonly Completion[] = []): void {
		this.points = points; this.forecast = forecast; this.completions = completions;
		if (this.visible) this.render();
	}

	private element<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>, parent: SVGElement = this.svg): SVGElementTagNameMap[K] {
		const element = this.root.ownerDocument.createElementNS(NS, tag);
		for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
		parent.appendChild(element);
		return element;
	}

	private render(): void {
		const width = Math.max(180, this.root.clientWidth || 409);
		const height = width * 170 / 409;
		this.layout = graphLayout(this.points, this.forecast, today(), width, height);
		this.svg.replaceChildren();
		this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
		const defs = this.element('defs', {});
		const gradient = this.element('linearGradient', { id: `${this.id}-area`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
		this.element('stop', { offset: '0%', 'stop-color': 'var(--horizon-graph-completed)', 'stop-opacity': '.22' }, gradient);
		this.element('stop', { offset: '100%', 'stop-color': 'var(--horizon-graph-completed)', 'stop-opacity': '0' }, gradient);
		const pattern = this.element('pattern', { id: `${this.id}-hatch`, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(35)' }, defs);
		this.element('line', { x1: 0, y1: 0, x2: 0, y2: 5, stroke: 'var(--horizon-graph-deadline)', 'stroke-opacity': '.3', 'stroke-width': 1 }, pattern);
		const wash = this.element('linearGradient', { id: `${this.id}-wash` }, defs);
		this.element('stop', { offset: '0%', 'stop-color': 'white', 'stop-opacity': '.6' }, wash);
		this.element('stop', { offset: '100%', 'stop-color': 'white', 'stop-opacity': '0' }, wash);
		const mask = this.element('mask', { id: `${this.id}-fade` }, defs);
		this.element('rect', { width, height, fill: `url(#${this.id}-wash)` }, mask);
		const layout = this.layout;
		for (const bar of completionBarGeometry(this.completions, layout.to, layout.x, layout.y(0), height)) {
			const rect = this.element('rect', { x: bar.x, y: bar.y, width: bar.width, height: bar.height, class: 'horizon-insights-completion-bar' });
			this.element('title', {}, rect).textContent = `${bar.count} observed completions in the seven-day bucket starting ${formatInsightDate(bar.date)}`;
		}
		this.element('line', { x1: 10, x2: width - 10, y1: layout.y(0), y2: layout.y(0), class: 'horizon-insights-baseline' });
		if (layout.deadlineX !== undefined) {
			if (this.forecast.kind === 'estimate' && this.forecast.later > this.forecast.deadline) this.element('rect', {
				x: layout.deadlineX, y: 0, width: Math.max(0, width - layout.deadlineX - 10), height,
				fill: `url(#${this.id}-hatch)`, mask: `url(#${this.id}-fade)`,
			});
			this.element('line', { x1: layout.deadlineX, x2: layout.deadlineX, y1: 3, y2: layout.y(0), class: 'horizon-insights-deadline' });
		}
		if (layout.areaPath) this.element('path', { d: layout.areaPath, fill: `url(#${this.id}-area)` });
		for (const [name, d] of [['scope', layout.scopePath], ['started', layout.startedPath], ['completed', layout.completedPath]]) {
			if (d) this.element('path', { d, class: `horizon-insights-line horizon-insights-${name}` });
		}
		for (const sample of layout.samples) {
			for (const [name, value] of [['scope', sample.point.scope], ['started', sample.point.started + sample.point.completed], ['completed', sample.point.completed]] as const) {
				this.element('circle', { cx: sample.x, cy: layout.y(value), r: 2, class: `horizon-insights-point horizon-insights-${name}` });
			}
		}
		for (const d of layout.forecastPaths) this.element('path', { d, class: 'horizon-insights-line horizon-insights-completed horizon-insights-projection' });
		if (this.forecast.kind === 'estimate') for (const finish of [this.forecast.earlier, this.forecast.finish, this.forecast.later]) {
			this.element('circle', { cx: layout.x(finish), cy: layout.y(this.points.at(-1)?.scope ?? 0), r: 2.5, class: 'horizon-insights-point horizon-insights-completed' });
		}
		this.overlay = this.element('g', {});
		this.showSelection();
	}

	private selectX(clientX: number): void {
		const layout = this.layout;
		if (!layout?.samples.length) return;
		const x = clientX - this.root.getBoundingClientRect().left;
		this.forecastSelected = this.forecast.kind === 'estimate' && x > layout.x(this.forecast.anchor) + 8;
		this.selection = layout.samples.reduce((best, sample, index) =>
			Math.abs(sample.x - x) < Math.abs((layout.samples[best]?.x ?? 0) - x) ? index : best, 0);
		this.showSelection();
	}

	private showSelection(): void {
		this.overlay?.replaceChildren();
		const sample = this.layout?.samples[this.selection];
		if (!sample || !this.layout || !this.overlay) { this.tooltip.hidden = true; return; }
		const forecast = this.forecast;
		let x = sample.x;
		if (this.forecastSelected && forecast.kind === 'estimate') {
			x = this.layout.x(forecast.finish);
			this.tooltip.textContent = `Plan-based estimate · ${formatInsightDate(forecast.finish)} · ${forecast.velocity.toLocaleString(undefined, { maximumFractionDigits: 2 })} items/week. Start ${formatInsightDate(forecast.start)}, deadline ${formatInsightDate(forecast.deadline)}. Started items count as one-quarter remaining work. Range ${formatInsightDate(forecast.earlier)}–${formatInsightDate(forecast.later)}.`;
		} else this.tooltip.textContent = `${formatInsightDate(sample.point.date)} · Scope ${sample.point.scope} · Started ${sample.point.started} · Completed ${sample.point.completed}${sample.gap ? ' · gap before observation' : ''}`;
		this.tooltip.hidden = false;
		this.element('line', { x1: x, x2: x, y1: 3, y2: this.layout.y(0), class: 'horizon-insights-crosshair' }, this.overlay);
		this.element('circle', { cx: x, cy: this.layout.y(this.forecastSelected ? this.points.at(-1)?.scope ?? 0 : sample.point.completed), r: 4, class: 'horizon-insights-point horizon-insights-completed' }, this.overlay);
	}

	private hideSelection(): void { this.selection = -1; this.forecastSelected = false; this.showSelection(); }
}
