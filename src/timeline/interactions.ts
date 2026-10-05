import { Component } from 'obsidian';
import { dayDifference, projectRange, shiftProjectDates } from '../planning/dates';
import type { PlanningProject, PlanningRenderContext, ProjectDates } from '../planning/types';
import { pixelToDate, resizeDates, TIMELINE_NAME_WIDTH, type TimelineLayout } from './scale';

const PROJECT_TRANSFER = 'application/x-horizon-project';
const OFFSET_TRANSFER = 'application/x-horizon-timeline-offset';

interface Gesture {
	pointerId: number;
	mode: 'pan' | 'plan' | 'start' | 'deadline';
	startX: number;
	startScroll: number;
	startDate: string;
	project?: PlanningProject;
	dates?: ProjectDates;
	moved: boolean;
}

/** Delegated listeners keep redraws cheap and cancel unsaved gestures on unload. */
export class TimelineInteractions extends Component {
	private gesture: Gesture | undefined;
	private dragged: PlanningProject | undefined;
	private dragOffset = 0;
	private suppressClick = false;

	constructor(private viewport: HTMLElement, private context: PlanningRenderContext,
		private layout: () => TimelineLayout,
		private preview: (project: PlanningProject, dates: ProjectDates) => void,
		private clearPreview: () => void, wheel: (event: WheelEvent) => void) {
		super();
		this.registerDomEvent(viewport, 'wheel', wheel, { passive: false });
		this.registerDomEvent(viewport, 'click', event => this.click(event));
		this.registerDomEvent(viewport, 'pointerdown', event => this.pointerDown(event));
		this.registerDomEvent(viewport.ownerDocument, 'pointermove', event => this.pointerMove(event));
		this.registerDomEvent(viewport.ownerDocument, 'pointerup', event => this.pointerUp(event));
		this.registerDomEvent(viewport.ownerDocument, 'pointercancel', () => this.cancel());
		this.registerDomEvent(viewport.ownerDocument, 'keydown', event => {
			if (event.key === 'Escape' && (this.gesture || this.dragged)) {
				event.preventDefault(); this.suppressClick = true; this.cancel();
			}
		});
		this.registerDomEvent(viewport, 'contextmenu', event => {
			if ((event.target as HTMLElement).closest('.horizon-timeline-track')) event.preventDefault();
		});
		this.registerDomEvent(viewport, 'dragstart', event => this.dragStart(event));
		this.registerDomEvent(viewport, 'dragover', event => this.dragOver(event));
		this.registerDomEvent(viewport, 'drop', event => this.drop(event));
		this.registerDomEvent(viewport, 'dragend', () => { this.dragged = undefined; this.clearPreview(); });
		this.registerDomEvent(viewport, 'dragleave', event => {
			if (!viewport.contains(event.relatedTarget as Node | null)) this.clearPreview();
		});
		this.registerDomEvent(viewport.ownerDocument, 'visibilitychange', () => {
			if (viewport.ownerDocument.hidden) this.cancel();
		});
		const win = viewport.ownerDocument.defaultView;
		if (win) this.registerDomEvent(win, 'blur', () => this.cancel());
		this.register(() => this.cancel());
	}

	cancel(): void {
		if (this.gesture) {
			this.suppressClick = this.gesture.moved || this.suppressClick;
			if (this.viewport.hasPointerCapture?.(this.gesture.pointerId)) this.viewport.releasePointerCapture(this.gesture.pointerId);
		}
		this.gesture = undefined;
		this.dragged = undefined;
		this.dragOffset = 0;
		this.viewport.removeClass('is-panning', 'is-selecting');
		this.clearPreview();
	}

	private project(id?: string): PlanningProject | undefined {
		return this.context.projects.find(project => project.id === id);
	}

	private dateAt(clientX: number): string {
		const rect = this.viewport.getBoundingClientRect();
		return pixelToDate(clientX - rect.left + this.viewport.scrollLeft - TIMELINE_NAME_WIDTH, this.layout());
	}

	private click(event: MouseEvent): void {
		if (this.suppressClick) { this.suppressClick = false; event.preventDefault(); return; }
		const target = event.target as HTMLElement;
		const open = target.closest<HTMLElement>('[data-timeline-open]');
		const edit = target.closest<HTMLElement>('[data-timeline-edit], [data-timeline-bar]');
		const project = this.project(open?.dataset.timelineOpen ?? edit?.dataset.timelineEdit ?? edit?.dataset.timelineBar);
		if (!project) return;
		if (open) this.context.open(project);
		else this.context.edit(project);
	}

	private pointerDown(event: PointerEvent): void {
		if (!event.isPrimary || (event.button !== 0 && event.button !== 2)) return;
		this.suppressClick = false;
		const target = event.target as HTMLElement;
		const row = target.closest<HTMLElement>('[data-timeline-row]');
		if (!row) return;
		const edge = target.closest<HTMLElement>('[data-timeline-edge]')?.dataset.timelineEdge;
		const project = this.project(row.dataset.timelineRow);
		const range = project && projectRange(project);
		const validRange = range && range.end >= range.start;
		let mode: Gesture['mode'];
		if (event.button === 2) mode = 'pan';
		else if (edge === 'start' || edge === 'deadline') mode = edge;
		else if (target.closest('[data-timeline-bar]')) return;
		else mode = !validRange ? 'plan' : 'pan';
		event.preventDefault();
		this.gesture = { pointerId: event.pointerId, mode, project, startX: event.clientX,
			startDate: this.dateAt(event.clientX), startScroll: this.viewport.scrollLeft, moved: false };
		this.viewport.setPointerCapture?.(event.pointerId);
		this.viewport.addClass(mode === 'pan' ? 'is-panning' : 'is-selecting');
	}

	private pointerMove(event: PointerEvent): void {
		const gesture = this.gesture;
		if (!gesture || gesture.pointerId !== event.pointerId) return;
		if (Math.abs(event.clientX - gesture.startX) > 4) gesture.moved = true;
		if (!gesture.moved) return;
		if (gesture.mode === 'pan') {
			this.viewport.scrollLeft = gesture.startScroll + gesture.startX - event.clientX;
			return;
		}
		const project = gesture.project;
		if (!project) return;
		const date = this.dateAt(event.clientX);
		gesture.dates = gesture.mode === 'plan' ? {
			start: date < gesture.startDate ? date : gesture.startDate,
			deadline: date > gesture.startDate ? date : gesture.startDate,
		} : resizeDates(project, gesture.mode, date);
		this.preview(project, gesture.dates);
	}

	private pointerUp(event: PointerEvent): void {
		const gesture = this.gesture;
		if (!gesture || gesture.pointerId !== event.pointerId) return;
		this.cancel();
		if (gesture.moved && gesture.project && gesture.dates) {
			void this.context.saveDates(gesture.project, gesture.dates);
		} else if (!gesture.moved && gesture.mode === 'plan' && gesture.project) {
			this.context.edit(gesture.project, { start: gesture.startDate, deadline: gesture.startDate });
		}
	}

	private dragStart(event: DragEvent): void {
		const bar = (event.target as HTMLElement).closest<HTMLElement>('[data-timeline-bar]');
		const project = this.project(bar?.dataset.timelineBar);
		const range = project && projectRange(project);
		if (!project || !range || !event.dataTransfer) return;
		this.dragged = project;
		this.dragOffset = dayDifference(range.start, this.dateAt(event.clientX));
		this.suppressClick = true;
		event.dataTransfer.setData(PROJECT_TRANSFER, project.id);
		event.dataTransfer.setData(OFFSET_TRANSFER, String(this.dragOffset));
		event.dataTransfer.effectAllowed = 'move';
	}

	private dragOver(event: DragEvent): void {
		if (!event.dataTransfer?.types.includes(PROJECT_TRANSFER)) return;
		if (!(event.target as HTMLElement).closest('[data-timeline-row]')) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		if (this.dragged) this.preview(this.dragged, this.dropDates(this.dragged, event, this.dragOffset));
	}

	private dropDates(project: PlanningProject, event: DragEvent, offset: number): ProjectDates {
		const range = projectRange(project);
		const date = this.dateAt(event.clientX);
		return range && range.end >= range.start ? shiftProjectDates(project, dayDifference(range.start, date) - offset)
			: { start: date, deadline: date };
	}

	private drop(event: DragEvent): void {
		if (!(event.target as HTMLElement).closest('[data-timeline-row]') || !event.dataTransfer) return;
		const project = this.project(event.dataTransfer.getData(PROJECT_TRANSFER));
		if (!project) return;
		event.preventDefault();
		const rawOffset = Number(event.dataTransfer.getData(OFFSET_TRANSFER));
		const offset = Number.isInteger(rawOffset) ? rawOffset : 0;
		const dates = this.dropDates(project, event, offset);
		this.cancel();
		void this.context.saveDates(project, dates);
	}
}
