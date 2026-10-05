import { Component } from 'obsidian';
import { addDays, dayDifference, parseDate, projectRange, shiftProjectDates } from '../planning/dates';
import type { DateKey, PlanningProject, PlanningRenderContext, ProjectDates } from '../planning/types';

const PROJECT_TRANSFER = 'application/x-horizon-project';
type Selection = { pointer: number; first: DateKey; current: DateKey; project?: PlanningProject; field?: 'start' | 'deadline' };

/** The renderer owns this component so document listeners are removed on every view refresh. */
export class CalendarInteractions extends Component {
	private selection?: Selection;
	private live!: HTMLElement;
	private suppressClickUntil = 0;

	constructor(private host: HTMLElement, private context: PlanningRenderContext) { super(); }

	onload(): void {
		this.live = this.host.createDiv({ cls: 'horizon-calendar-live' });
		this.live.setAttribute('aria-live', 'polite');
		const document = this.host.ownerDocument;
		this.registerDomEvent(document, 'pointermove', event => this.moveSelection(event));
		this.registerDomEvent(document, 'pointerup', event => this.finishSelection(event));
		this.registerDomEvent(document, 'pointercancel', () => this.clearSelection());
		this.registerDomEvent(document, 'keydown', event => { if (event.key === 'Escape') this.clearSelection(); });
		this.registerDomEvent(this.host, 'click', event => {
			if (Date.now() < this.suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
		}, true);
	}

	registerWeek(week: HTMLElement, start: DateKey, count: number, canSelect = true): void {
		week.dataset.calendarStart = start;
		week.dataset.calendarDays = String(count);
		this.registerDomEvent(week, 'dragover', event => {
			if (!event.dataTransfer?.types.includes(PROJECT_TRANSFER)) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = 'move';
			this.preview(this.dateAt(week, event.clientX), this.dateAt(week, event.clientX));
		});
		this.registerDomEvent(week, 'dragleave', event => {
			if (!(event.relatedTarget instanceof Node) || !week.contains(event.relatedTarget)) this.clearPreview();
		});
		this.registerDomEvent(week, 'drop', event => {
			const payload = event.dataTransfer?.getData(PROJECT_TRANSFER);
			if (!payload) return;
			event.preventDefault();
			event.stopPropagation();
			this.clearPreview();
			let id = payload;
			let anchor: DateKey | undefined;
			if (payload.startsWith('{')) {
				try {
					const parsed = JSON.parse(payload) as { id?: unknown; anchor?: unknown };
					if (typeof parsed.id === 'string') id = parsed.id;
					anchor = parseDate(parsed.anchor);
				} catch { return; }
			}
			const project = this.context.projects.find(item => item.id === id);
			if (!project) return;
			const date = this.dateAt(week, event.clientX);
			const range = projectRange(project);
			const dates = range && range.end >= range.start ? shiftProjectDates(project, dayDifference(anchor ?? range.start, date)) : { start: date };
			void this.context.saveDates(project, dates);
		});
		if (!canSelect) return;
		this.registerDomEvent(week, 'pointerdown', event => {
			if (event.button !== 0 || event.pointerType === 'touch' || this.selection || !(event.target instanceof Element)) return;
			if (event.target.closest('button, [draggable="true"]')) return;
			event.preventDefault();
			const date = this.dateAt(week, event.clientX);
			this.selection = { pointer: event.pointerId, first: date, current: date };
			this.preview(date, date);
		});
	}

	registerProject(button: HTMLButtonElement, week: HTMLElement, project: PlanningProject, start: DateKey): void {
		button.draggable = true;
		this.registerDomEvent(button, 'dragstart', event => {
			if (!event.dataTransfer) return;
			const anchor = this.dateAt(week, event.clientX) || start;
			event.dataTransfer.setData(PROJECT_TRANSFER, JSON.stringify({ id: project.id, anchor }));
			event.dataTransfer.setData('text/plain', project.title);
			event.dataTransfer.effectAllowed = 'move';
			this.clearSelection();
			button.addClass('is-dragging');
		});
		this.registerDomEvent(button, 'dragend', () => { button.removeClass('is-dragging'); this.clearPreview(); });
	}

	registerEdge(edge: HTMLButtonElement, project: PlanningProject, field: 'start' | 'deadline'): void {
		this.registerDomEvent(edge, 'pointerdown', event => {
			if (event.button !== 0) return;
			const range = projectRange(project);
			if (!range) return;
			event.preventDefault();
			event.stopPropagation();
			const date = field === 'start' ? range.start : range.end;
			this.selection = { pointer: event.pointerId, first: date, current: date, project, field };
			this.preview(range.start, range.end);
		});
		this.registerDomEvent(edge, 'click', event => { event.preventDefault(); event.stopPropagation(); });
		this.registerDomEvent(edge, 'keydown', event => {
			if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
			const range = projectRange(project);
			if (!range) return;
			event.preventDefault();
			const date = addDays(field === 'start' ? range.start : range.end, event.key === 'ArrowLeft' ? -1 : 1);
			if ((field === 'start' && date > range.end) || (field === 'deadline' && date < range.start)) return;
			void this.context.saveDates(project, this.resized(project, field, date));
		});
	}

	private dateAt(week: HTMLElement, x: number): DateKey {
		const rect = week.getBoundingClientRect();
		const count = Number(week.dataset.calendarDays ?? 1);
		const column = Math.max(0, Math.min(count - 1, Math.floor((x - rect.left) / (rect.width / count))));
		return addDays(week.dataset.calendarStart!, column);
	}

	private moveSelection(event: PointerEvent): void {
		const selection = this.selection;
		if (!selection || selection.pointer !== event.pointerId) return;
		const element = this.host.ownerDocument.elementFromPoint(event.clientX, event.clientY);
		const week = element?.closest<HTMLElement>('[data-calendar-start]');
		if (!week || !this.host.contains(week)) return;
		let current = this.dateAt(week, event.clientX);
		if (selection.project) {
			const range = projectRange(selection.project)!;
			if (selection.field === 'start' && current > range.end) current = range.end;
			if (selection.field === 'deadline' && current < range.start) current = range.start;
			this.preview(selection.field === 'start' ? current : range.start, selection.field === 'deadline' ? current : range.end);
		} else this.preview(selection.first, current);
		selection.current = current;
	}

	private finishSelection(event: PointerEvent): void {
		const selection = this.selection;
		if (!selection || selection.pointer !== event.pointerId) return;
		this.clearSelection();
		this.suppressClickUntil = Date.now() + 100;
		if (selection.project && selection.field) {
			if (selection.current !== selection.first) void this.context.saveDates(selection.project, this.resized(selection.project, selection.field, selection.current));
			return;
		}
		const first = selection.first < selection.current ? selection.first : selection.current;
		const last = selection.first < selection.current ? selection.current : selection.first;
		this.context.create(first, last === first ? undefined : last);
	}

	private resized(project: PlanningProject, field: 'start' | 'deadline', date: DateKey): ProjectDates {
		const range = projectRange(project)!;
		return { start: project.start ?? range.start, deadline: project.deadline ?? range.end, [field]: date };
	}

	private preview(first: DateKey, last: DateKey): void {
		const start = first < last ? first : last;
		const end = first < last ? last : first;
		for (const cell of Array.from(this.host.querySelectorAll<HTMLElement>('[data-date]'))) {
			cell.toggleClass('is-selected-date', cell.dataset.date! >= start && cell.dataset.date! <= end);
		}
		this.live.textContent = start === end ? start : `${start} to ${end}`;
	}

	private clearPreview(): void {
		for (const cell of Array.from(this.host.querySelectorAll('.is-selected-date'))) cell.removeClass('is-selected-date');
		this.live.textContent = '';
	}

	private clearSelection(): void { this.selection = undefined; this.clearPreview(); }
}
