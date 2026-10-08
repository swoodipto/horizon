import { Component } from 'obsidian';
import { formatInsightAxisDate, formatInsightDate } from './format';
import { paceLayout, percentage, type Pace } from './pace';
import type { DateKey } from '../planning/types';

const NS = 'http://www.w3.org/2000/svg';
interface Anchor { date: DateKey; kind: 'start' | 'today' | 'deadline' | 'estimate' }
let nextGraph = 0;

export class PaceGraph extends Component {
	private svg: SVGSVGElement;
	private tooltip: HTMLElement;
	private pace: Pace | undefined;
	private layout: ReturnType<typeof paceLayout> | undefined;
	private anchors: Anchor[] = [];
	private selection = -1;
	private overlay: SVGElement | undefined;
	private touch: { x: number; y: number; cancelled: boolean } | undefined;
	private visible = false;
	private id = `horizon-pace-${nextGraph++}`;

	constructor(private root: HTMLElement) {
		super();
		root.classList.add('horizon-insights-plot');
		root.tabIndex = 0;
		root.dataset.focusRole = 'graph';
		root.setAttribute('role', 'group');
		this.svg = root.ownerDocument.createElementNS(NS, 'svg');
		this.svg.setAttribute('aria-hidden', 'true'); root.appendChild(this.svg);
		this.tooltip = root.createDiv({ cls: 'horizon-insights-tooltip', attr: { role: 'status', 'aria-live': 'polite' } });
		this.tooltip.hidden = true;
		this.registerDomEvent(root, 'pointerdown', event => {
			if (event.pointerType === 'touch') this.touch = { x: event.clientX, y: event.clientY, cancelled: false };
		});
		this.registerDomEvent(root, 'pointermove', event => {
			if (event.pointerType === 'touch') {
				if (this.touch && Math.hypot(event.clientX - this.touch.x, event.clientY - this.touch.y) > 6) {
					this.touch.cancelled = true; this.clear();
				}
			} else this.selectX(event.clientX);
		});
		this.registerDomEvent(root, 'pointerup', event => {
			if (event.pointerType === 'touch' && this.touch && !this.touch.cancelled) this.selectX(event.clientX);
			this.touch = undefined;
		});
		this.registerDomEvent(root, 'pointercancel', () => { this.touch = undefined; this.clear(); });
		this.registerDomEvent(root, 'pointerleave', event => { if (event.pointerType !== 'touch') this.clear(); });
		this.registerDomEvent(root, 'blur', () => this.clear());
		this.registerDomEvent(root, 'keydown', event => {
			if (!this.pace || !this.anchors.length) return;
			if (event.target !== root || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
			if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
			event.preventDefault(); event.stopPropagation();
			if (event.key === 'Escape') { this.clear(); return; }
			const last = this.anchors.length - 1;
			this.selection = event.key === 'Home' ? 0 : event.key === 'End' ? last
				: Math.max(0, Math.min(last, this.selection < 0 ? this.anchors.findIndex(anchor => anchor.kind === 'today')
					: this.selection + (event.key === 'ArrowRight' ? 1 : -1)));
			this.showSelection();
		});
		const resize = new ResizeObserver(() => { if (this.visible) this.render(); });
		resize.observe(root); this.register(() => resize.disconnect());
		if (typeof IntersectionObserver !== 'undefined') {
			const observer = new IntersectionObserver(entries => {
				this.visible = entries.some(entry => entry.isIntersecting);
				if (this.visible) this.render();
			}, { rootMargin: '160px' });
			observer.observe(root); this.register(() => observer.disconnect());
		} else this.visible = true;
	}

	update(pace: Pace): void {
		this.pace = pace;
		this.anchors = [{ date: pace.today, kind: 'today' }];
		if (pace.kind !== 'unavailable') {
			this.anchors.unshift({ date: pace.start!, kind: 'start' });
			if (pace.deadline) this.anchors.push({ date: pace.deadline, kind: 'deadline' });
			if (pace.estimatedEnd) this.anchors.push({ date: pace.estimatedEnd, kind: 'estimate' });
		}
		// Keep coincident deadlines and estimates separately inspectable.
		this.anchors.sort((a, b) => a.date.localeCompare(b.date));
		this.selection = -1;
		this.tooltip.hidden = true;
		this.root.setAttribute('aria-label', `Percentage pace. Today ${percentage(pace.progress)} actual${pace.requiredToday === undefined ? '' : `, ${percentage(pace.requiredToday)} required`}${pace.estimatedEnd ? `, estimated finish ${formatInsightDate(pace.estimatedEnd)}` : ''}. Implied average pace, not recorded history. Use left and right arrows to inspect date anchors; Escape clears selection.`);
		if (this.visible) this.render();
	}

	private element(tag: string, attrs: Record<string, string | number>, parent: SVGElement = this.svg): SVGElement {
		const el = this.root.ownerDocument.createElementNS(NS, tag);
		for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
		parent.appendChild(el); return el;
	}

	private render(): void {
		if (!this.pace) return;
		const width = Math.max(80, this.root.clientWidth || 409), height = Math.max(100, width * .88);
		const pace = this.pace, layout = paceLayout(pace, width, height); this.layout = layout;
		this.svg.replaceChildren();
		const defs = this.element('defs', {});
		const gradient = this.element('linearGradient', { id: `${this.id}-area`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
		this.element('stop', { offset: '0%', 'stop-color': 'var(--horizon-graph-completed)', 'stop-opacity': '.2' }, gradient);
		this.element('stop', { offset: '100%', 'stop-color': 'var(--horizon-graph-completed)', 'stop-opacity': '0' }, gradient);
		for (const value of [0, 50, 100]) {
			this.element('line', { x1: 16, x2: width - 16, y1: layout.y(value), y2: layout.y(value), class: 'horizon-insights-baseline' });
		}
		if (layout.actualPath) this.element('path', { d: `${layout.actualPath} L ${layout.current.x} ${layout.y(0)} Z`, fill: `url(#${this.id}-area)` });
		if (layout.requiredPath) this.element('path', { d: layout.requiredPath, class: 'horizon-insights-line horizon-pace-required horizon-insights-projection' });
		if (pace.kind === 'scheduled' || pace.kind === 'same-day') {
			this.element('line', { x1: layout.x(pace.deadline!), x2: layout.x(pace.deadline!), y1: layout.y(100), y2: layout.y(0), class: 'horizon-insights-deadline' });
			this.element('circle', { cx: layout.x(pace.deadline!), cy: layout.y(100), r: 3, class: 'horizon-insights-point horizon-pace-required' });
			this.element('circle', { cx: layout.current.x, cy: layout.y(pace.requiredToday!), r: 3, class: 'horizon-insights-point horizon-pace-required' });
		}
		if (layout.actualPath) this.element('path', { d: layout.actualPath, class: 'horizon-insights-line horizon-pace-actual' });
		if (layout.estimatePath) {
			this.element('path', { d: layout.estimatePath, class: 'horizon-insights-line horizon-pace-actual horizon-insights-projection' });
			this.element('circle', { cx: layout.estimateX!, cy: layout.y(100), r: 3, class: 'horizon-insights-point horizon-pace-actual' });
		}
		this.element('circle', { cx: layout.current.x, cy: layout.current.y, r: 4.5, class: 'horizon-insights-point horizon-pace-actual' });
		const dates = [layout.from];
		if (pace.deadline && pace.kind !== 'unavailable' && pace.deadline > layout.from && pace.deadline < layout.to) dates.push(pace.deadline);
		if (layout.to !== layout.from) dates.push(layout.to);
		let axisHeight = height + 10;
		for (const date of dates) {
			const x = layout.x(date);
			const interior = date > layout.from && date < layout.to;
			// Keep a deadline aligned with its marker even when its label is near an endpoint.
			const crowded = interior
				&& Math.min(x - layout.x(layout.from), layout.x(layout.to) - x) < 48;
			const y = layout.y(0) + 24 + (crowded ? 20 : 0);
			if (crowded) axisHeight += 20;
			const alignment = layout.from === layout.to ? 'middle' : date === layout.from ? 'start' : date === layout.to ? 'end' : 'middle';
			this.element('text', { x, y, 'text-anchor': alignment,
				class: `horizon-pace-tick${interior ? ' horizon-pace-interior-date' : ''}`,
				...(interior ? { style: `--horizon-pace-date-top-offset: ${layout.y(100) - 10 - y}px` } : {}),
			}).textContent = formatInsightAxisDate(date);
		}
		this.svg.setAttribute('viewBox', `0 0 ${width} ${axisHeight}`);
		this.overlay = this.element('g', {}); this.showSelection();
	}

	private selectX(clientX: number): void {
		if (!this.layout) return;
		const bounds = this.root.getBoundingClientRect();
		const x = (clientX - bounds.left) * this.layout.width / (bounds.width || this.root.clientWidth || this.layout.width);
		this.selection = this.anchors.reduce((best, anchor, index) =>
			Math.abs(this.anchorX(anchor) - x) < Math.abs(this.anchorX(this.anchors[best]!) - x) ? index : best, 0);
		this.showSelection();
	}

	private anchorX(anchor: Anchor): number {
		return anchor.kind === 'estimate' && this.layout!.estimateX !== undefined
			? this.layout!.estimateX : this.layout!.x(anchor.date);
	}

	private showSelection(): void {
		this.overlay?.replaceChildren();
		const anchor = this.anchors[this.selection], pace = this.pace, layout = this.layout;
		if (!anchor || !pace || !layout || !this.overlay) { this.tooltip.hidden = true; return; }
		const date = anchor.date;
		// Distinguish the optional finish projection from required targets and observations.
		this.tooltip.textContent = anchor.kind === 'today'
			? `Today · ${formatInsightDate(date)} · ${percentage(pace.progress)} actual${pace.requiredToday === undefined ? '' : ` · ${percentage(pace.requiredToday)} required`}`
			: anchor.kind === 'start' ? `Start · ${formatInsightDate(date)} · 0% implied anchor, not an observation`
				: anchor.kind === 'estimate' ? `Estimated finish · ${formatInsightDate(date)} · 100% at current implied pace, not a deadline`
					: `Deadline · ${formatInsightDate(date)} · 100% required target, not a forecast`;
		this.tooltip.hidden = false;
		const x = this.anchorX(anchor);
		this.element('line', { x1: x, x2: x, y1: layout.y(100), y2: layout.y(0), class: 'horizon-insights-crosshair' }, this.overlay);
	}

	private clear(): void { this.selection = -1; this.showSelection(); }
}
