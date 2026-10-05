import { Component } from 'obsidian';
import { addDays, addMonths, dayDifference, projectRange, today } from '../planning/dates';
import type { PlanningProject, PlanningRenderContext, ProjectDates, TimelineScale } from '../planning/types';
import { TimelineInteractions } from './interactions';
import { renderDependencies } from './dependencies';
import { barGeometry, clampZoom, dateToPixel, timelineLayout, TIMELINE_AXIS_HEIGHT,
	TIMELINE_NAME_WIDTH, TIMELINE_ROW_HEIGHT, type TimelineLayout } from './scale';

function monthLabel(date: string, year = false): string {
	const value = new Date(0);
	value.setUTCFullYear(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1);
	return new Intl.DateTimeFormat(undefined, { month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(value);
}

/** Native DOM timeline. Storage and note creation stay in the planning context. */
export class TimelineRenderer extends Component {
	private zoom: number;
	private layout!: TimelineLayout;
	private viewport!: HTMLElement;
	private canvas!: HTMLElement;
	private axis!: HTMLElement;
	private arrows!: SVGSVGElement;
	private bars = new Map<string, HTMLElement>();
	private tracks = new Map<string, HTMLElement>();
	private preview: HTMLElement | undefined;
	private interactions: TimelineInteractions | undefined;

	constructor(private host: HTMLElement, private context: PlanningRenderContext,
		private scale: TimelineScale, zoom: number, private onZoom: (zoom: number) => void) {
		super();
		this.zoom = clampZoom(zoom);
	}

	onload(): void {
		this.layout = timelineLayout(this.context.date, this.scale, this.zoom);
		this.viewport = this.host.createDiv({ cls: 'horizon-timeline', attr: {
			'aria-label': 'Project timeline', tabindex: '0', role: 'region',
		} });
		this.canvas = this.viewport.createDiv({ cls: 'horizon-timeline-canvas' });
		this.axis = this.canvas.createDiv({ cls: 'horizon-timeline-axis' });
		const rows = this.canvas.createDiv({ cls: 'horizon-timeline-rows' });
		for (const project of this.context.projects) this.renderRow(rows, project);
		this.arrows = this.host.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
		this.arrows.classList.add('horizon-timeline-dependencies');
		this.arrows.setAttribute('aria-hidden', 'true');
		this.canvas.appendChild(this.arrows);
		this.updateGeometry();
		this.interactions = this.addChild(new TimelineInteractions(this.viewport, this.context,
			() => this.layout, (project, dates) => this.showPreview(project, dates),
			() => this.clearPreview(), event => this.zoomAt(event)));
		this.registerDomEvent(this.viewport, 'keydown', event => {
			if (event.target !== this.viewport) return;
			if (event.key === '+' || event.key === '=') { event.preventDefault(); this.setZoom(this.zoom * 1.25); }
			if (event.key === '-') { event.preventDefault(); this.setZoom(this.zoom / 1.25); }
		});
		this.register(() => { this.clearPreview(); this.viewport.remove(); });
		const center = dateToPixel(this.context.date, this.layout);
		this.viewport.scrollLeft = Math.max(0, TIMELINE_NAME_WIDTH + center - this.viewport.clientWidth / 2);
	}

	/** Toolbar zoom keeps the date beneath the center of the visible track fixed. */
	setZoom(zoom: number, clientX?: number): void {
		const next = clampZoom(zoom);
		if (next === this.zoom) return;
		if (!this.viewport) { this.zoom = next; return; }
		this.interactions?.cancel();
		const rect = this.viewport.getBoundingClientRect();
		const local = clientX === undefined ? (this.viewport.clientWidth + TIMELINE_NAME_WIDTH) / 2 : clientX - rect.left;
		const anchor = (this.viewport.scrollLeft + local - TIMELINE_NAME_WIDTH) / this.layout.pixelsPerDay;
		this.zoom = next;
		this.layout = timelineLayout(this.context.date, this.scale, next);
		this.updateGeometry();
		this.viewport.scrollLeft = Math.max(0, TIMELINE_NAME_WIDTH + anchor * this.layout.pixelsPerDay - local);
		this.onZoom(next);
	}

	private zoomAt(event: WheelEvent): void {
		if (!event.ctrlKey && !event.metaKey) return;
		event.preventDefault();
		this.setZoom(this.zoom * Math.exp(-event.deltaY * 0.002), event.clientX);
	}

	private renderRow(rows: HTMLElement, project: PlanningProject): void {
		const range = projectRange(project);
		const validRange = range && range.end >= range.start;
		const row = rows.createDiv({ cls: 'horizon-timeline-row', attr: { 'data-project-id': project.id } });
		const name = row.createDiv({ cls: 'horizon-timeline-name' });
		name.createEl('button', { text: project.title, cls: 'horizon-timeline-title', attr: {
			'data-timeline-open': project.id, type: 'button', title: `Open ${project.title}`,
		} });
		const warnings = this.context.warnings.filter(warning => warning.projectId === project.id);
		if (warnings.length) name.createSpan({ text: '⚠', cls: 'horizon-timeline-warning', attr: {
			title: warnings.map(warning => warning.message).join('\n'), 'aria-label': warnings.map(warning => warning.message).join('. '),
		} });
		name.createEl('button', { text: validRange ? 'Edit' : 'Plan', cls: 'horizon-timeline-plan', attr: {
			'data-timeline-edit': project.id, type: 'button', 'aria-label': `${validRange ? 'Edit dates for' : 'Plan'} ${project.title}`,
		} });
		const track = row.createDiv({ cls: 'horizon-timeline-track', attr: { 'data-timeline-row': project.id } });
		this.tracks.set(project.id, track);
		if (!validRange) {
			track.createSpan({ text: 'Drag here to plan, or select Plan', cls: 'horizon-timeline-unplanned' });
			return;
		}
		const bar = track.createEl('button', { cls: 'horizon-timeline-bar', attr: {
			'aria-label': `${project.title}: ${range.start} to ${range.end}. Select to edit dates.`,
			'data-timeline-bar': project.id, type: 'button', draggable: 'true',
			title: `${project.title}\n${range.start} → ${range.end}${warnings.length ? `\n${warnings.map(warning => warning.message).join('\n')}` : ''}`,
		} });
		if (project.color && /^(#[\da-f]{3,8}|[a-z]+)$/i.test(project.color)) bar.setCssProps({ '--horizon-project-color': project.color });
		bar.toggleClass('is-completed', project.status === 'completed');
		bar.toggleClass('has-warning', warnings.length > 0);
		for (const edge of ['start', 'deadline']) {
			bar.createSpan({ cls: `horizon-timeline-handle horizon-timeline-handle-${edge}`, attr: {
				'data-timeline-edge': edge, 'aria-hidden': 'true',
			} });
		}
		bar.createSpan({ text: project.title, cls: 'horizon-timeline-bar-label' });
		this.bars.set(project.id, bar);
	}

	private updateGeometry(): void {
		this.canvas.setCssProps({ '--horizon-timeline-width': `${this.layout.width}px`,
			'--horizon-timeline-names': `${TIMELINE_NAME_WIDTH}px`,
			'--horizon-timeline-grid': `${this.layout.pixelsPerDay * (this.layout.pixelsPerDay < 5 ? 7 : 1)}px`,
			'--horizon-timeline-row': `${TIMELINE_ROW_HEIGHT}px`, '--horizon-timeline-axis': `${TIMELINE_AXIS_HEIGHT}px` });
		this.renderAxis();
		for (const project of this.context.projects) {
			const bar = this.bars.get(project.id);
			const range = projectRange(project);
			if (!bar || !range) continue;
			const geometry = barGeometry(range, this.layout);
			bar.hidden = !geometry;
			if (geometry) this.positionBar(bar, geometry);
		}
		const currentDay = today();
		for (const track of this.tracks.values()) {
			track.querySelector('.horizon-timeline-current-day')?.remove();
			if (currentDay >= this.layout.start && currentDay < this.layout.end) {
				const marker = track.createSpan({ cls: 'horizon-timeline-current-day', attr: { 'aria-hidden': 'true' } });
				marker.setCssProps({ left: `${dateToPixel(currentDay, this.layout)}px` });
			}
		}
		renderDependencies(this.arrows, this.context, this.layout);
	}

	private positionBar(bar: HTMLElement, geometry: NonNullable<ReturnType<typeof barGeometry>>): void {
		bar.toggleClass('is-single-day', geometry.single);
		bar.toggleClass('continues-before', geometry.before);
		bar.toggleClass('continues-after', geometry.after);
		bar.setCssProps({ left: `${geometry.single ? geometry.left + geometry.width / 2 - 10 : geometry.left}px`,
			width: `${geometry.single ? 20 : Math.max(2, geometry.width)}px` });
	}

	private renderAxis(): void {
		this.axis.empty();
		this.axis.createDiv({ cls: 'horizon-timeline-axis-name', text: 'Projects' });
		const track = this.axis.createDiv({ cls: 'horizon-timeline-axis-track' });
		const upper = track.createDiv({ cls: 'horizon-timeline-axis-upper' });
		const lower = track.createDiv({ cls: 'horizon-timeline-axis-lower' });
		const yearScale = this.scale === 'five-years';
		for (let date = this.layout.start; date < this.layout.end; date = addMonths(date, yearScale ? 12 : 1)) {
			const end = addMonths(date, yearScale ? 12 : 1);
			const tick = upper.createSpan({ cls: 'horizon-timeline-axis-period', text: yearScale ? date.slice(0, 4) : monthLabel(date, true) });
			tick.setCssProps({ left: `${dateToPixel(date, this.layout)}px`, width: `${dayDifference(date, end) * this.layout.pixelsPerDay}px` });
		}
		for (let date = this.layout.start; date < this.layout.end;) {
			const monthly = this.scale === 'year' || yearScale;
			const next = monthly ? addMonths(date, 1) : addDays(date, this.scale === 'quarter' ? 7 : 1);
			const tick = lower.createSpan({ cls: 'horizon-timeline-axis-tick', text: monthly ? monthLabel(date) : String(Number(date.slice(8, 10))), attr: { title: date } });
			tick.setCssProps({ left: `${dateToPixel(date, this.layout)}px`, width: `${dayDifference(date, next) * this.layout.pixelsPerDay}px` });
			date = next;
		}
	}

	private showPreview(project: PlanningProject, dates: ProjectDates): void {
		this.clearPreview();
		const track = this.tracks.get(project.id);
		const range = projectRange(dates);
		const geometry = range && barGeometry(range, this.layout);
		if (!track || !geometry || !range) return;
		this.preview = track.createDiv({ cls: 'horizon-timeline-bar horizon-timeline-preview', text: `${range.start} → ${range.end}` });
		this.positionBar(this.preview, geometry);
	}

	private clearPreview(): void { this.preview?.remove(); this.preview = undefined; }
}
