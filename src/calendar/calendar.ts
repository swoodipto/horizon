import { Component } from 'obsidian';
import { projectRange, today } from '../planning/dates';
import type { CalendarMode, DateKey, PlanningProject, PlanningRenderContext } from '../planning/types';
import { CalendarInteractions } from './interactions';
import { calendarWeeks, yearMonths, type CalendarSegment, type CalendarWeek } from './layout';

function dateLabel(date: DateKey, options: Intl.DateTimeFormatOptions): string {
	return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, options);
}

/** Native all-day project calendars; each displayed date refers to the same note metadata. */
export class CalendarRenderer extends Component {
	private root!: HTMLElement;
	private interactions!: CalendarInteractions;

	constructor(private host: HTMLElement, private context: PlanningRenderContext, private mode: CalendarMode) {
		super();
	}

	onload(): void {
		this.root = this.host.createDiv({ cls: `horizon-calendar horizon-calendar-mode-${this.mode}` });
		this.interactions = this.addChild(new CalendarInteractions(this.root, this.context));
		if (this.mode === 'year') this.renderYear();
		else this.renderDates(this.mode);
	}

	onunload(): void { this.root?.remove(); }

	private renderDates(mode: Exclude<CalendarMode, 'year'>): void {
		const weeks = calendarWeeks(this.context.date, mode, this.context.projects);
		const count = weeks[0]?.days.length ?? 7;
		const headings = this.root.createDiv({ cls: 'horizon-calendar-weekdays' });
		headings.style.setProperty('--horizon-calendar-columns', String(count));
		for (const date of weeks[0]?.days ?? []) {
			headings.createDiv({ text: dateLabel(date, { weekday: mode === 'month' ? 'short' : 'long' }) });
		}
		const body = this.root.createDiv({ cls: 'horizon-calendar-weeks' });
		for (const week of weeks) this.renderWeek(body, week, mode);
		this.root.createDiv({ cls: 'horizon-calendar-help', text: 'Select a project to edit. Drag to move, drag an edge to resize, or select empty dates to plan a project.' });
	}

	private renderWeek(host: HTMLElement, week: CalendarWeek, mode: Exclude<CalendarMode, 'year'>): void {
		const row = host.createDiv({ cls: 'horizon-calendar-week' });
		row.dataset.start = week.start;
		row.dataset.days = String(week.days.length);
		row.style.setProperty('--horizon-calendar-columns', String(week.days.length));
		const backgrounds = row.createDiv({ cls: 'horizon-calendar-days' });
		for (const date of week.days) {
			const cell = backgrounds.createDiv({ cls: 'horizon-calendar-day-cell' });
			cell.dataset.date = date;
			if (date === today()) cell.addClass('is-today');
			if (mode === 'month' && date.slice(0, 7) !== this.context.date.slice(0, 7)) cell.addClass('is-outside-month');
			const label = mode === 'month' ? String(Number(date.slice(8))) : dateLabel(date, { month: 'short', day: 'numeric' });
			const button = cell.createEl('button', { cls: 'horizon-calendar-date', text: label });
			button.setAttribute('aria-label', `Open ${dateLabel(date, { dateStyle: 'full' })}`);
			if (date === today()) button.setAttribute('aria-current', 'date');
			this.registerDomEvent(button, 'click', () => this.context.navigate(date, 'day'));
			const plan = cell.createEl('button', { cls: 'horizon-calendar-add', text: '+' });
			plan.setAttribute('aria-label', `Plan a project on ${date}`);
			plan.setAttribute('title', `Plan a project on ${date}`);
			this.registerDomEvent(plan, 'click', () => this.context.create(date));
		}
		const events = row.createDiv({ cls: 'horizon-calendar-events' });
		events.style.setProperty('--horizon-calendar-lanes', String(Math.max(week.lanes, mode === 'month' ? 2 : 4)));
		for (const segment of week.segments) this.renderProject(events, row, segment);
		this.interactions.registerWeek(row, week.start, week.days.length);
	}

	private renderProject(host: HTMLElement, week: HTMLElement, segment: CalendarSegment): void {
		const { project } = segment;
		const warnings = this.context.warnings.filter(warning => warning.projectId === project.id);
		const bar = host.createDiv({ cls: 'horizon-calendar-project' });
		bar.dataset.projectId = project.id;
		bar.style.gridColumn = `${segment.column + 1} / span ${segment.length}`;
		bar.style.gridRow = String(segment.lane + 1);
		if (project.color) bar.style.setProperty('--horizon-project-color', project.color);
		if (warnings.length) bar.addClass('has-warning');
		if (project.status === 'completed') bar.addClass('is-completed');
		if (segment.continuesBefore) bar.addClass('continues-before');
		if (segment.continuesAfter) bar.addClass('continues-after');
		const range = projectRange(project);
		const details = `${project.title}\n${project.start ?? 'No start date'} → ${project.deadline ?? 'No deadline'}${warnings.length ? `\n${warnings.map(item => item.message).join('\n')}` : ''}`;
		bar.setAttribute('title', details);
		if (!segment.continuesBefore) this.addEdge(bar, project, 'start');
		const edit = bar.createEl('button', { cls: 'horizon-calendar-project-label', text: `${segment.continuesBefore ? '‹ ' : ''}${project.title}${segment.continuesAfter ? ' ›' : ''}` });
		edit.setAttribute('aria-label', `Edit ${project.title}, ${range?.start ?? ''} to ${range?.end ?? ''}${warnings.length ? ', has planning warnings' : ''}`);
		this.registerDomEvent(edit, 'click', () => this.context.edit(project));
		this.interactions.registerProject(edit, week, project, segment.start);
		if (warnings.length) bar.createSpan({ cls: 'horizon-calendar-warning', text: '!' }).setAttribute('aria-label', 'Planning warning');
		if (project.deadline && project.deadline >= segment.start && project.deadline <= segment.end) {
			bar.createSpan({ cls: 'horizon-calendar-deadline', text: '◆' }).setAttribute('aria-label', `Deadline ${project.deadline}`);
		}
		const open = bar.createEl('button', { cls: 'horizon-calendar-open', text: '↗' });
		open.setAttribute('aria-label', `Open ${project.title}`);
		open.setAttribute('title', 'Open project note');
		this.registerDomEvent(open, 'click', () => this.context.open(project));
		if (!segment.continuesAfter) this.addEdge(bar, project, 'deadline');
	}

	private addEdge(host: HTMLElement, project: PlanningProject, field: 'start' | 'deadline'): void {
		const edge = host.createEl('button', { cls: `horizon-calendar-edge horizon-calendar-edge-${field}` });
		edge.setAttribute('aria-label', `Resize ${project.title} ${field}. Use left and right arrow keys to change by one day.`);
		edge.setAttribute('title', `Drag to change ${field}`);
		this.interactions.registerEdge(edge, project, field);
	}

	private renderYear(): void {
		const year = this.root.createDiv({ cls: 'horizon-calendar-year-grid' });
		for (const month of yearMonths(this.context.date)) {
			const panel = year.createDiv({ cls: 'horizon-calendar-mini-month' });
			const title = panel.createEl('button', { cls: 'horizon-calendar-month-title', text: dateLabel(month, { month: 'long' }) });
			this.registerDomEvent(title, 'click', () => this.context.navigate(month, 'month'));
			const weekdays = panel.createDiv({ cls: 'horizon-calendar-mini-weekdays' });
			const weeks = calendarWeeks(month, 'month', this.context.projects);
			for (const date of weeks[0]?.days ?? []) weekdays.createSpan({ text: dateLabel(date, { weekday: 'narrow' }) });
			const dates = panel.createDiv({ cls: 'horizon-calendar-mini-dates' });
			for (const week of weeks) for (const date of week.days) {
				const projects = this.context.projects.filter(project => {
					const range = projectRange(project);
					return range && range.start <= date && range.end >= date;
				});
				const button = dates.createEl('button', { cls: 'horizon-calendar-mini-date', text: String(Number(date.slice(8))) });
				button.dataset.date = date;
				if (date.slice(0, 7) !== month.slice(0, 7)) button.addClass('is-outside-month');
				if (date === today()) { button.addClass('is-today'); button.setAttribute('aria-current', 'date'); }
				if (projects.length) {
					button.addClass('has-projects');
					button.createSpan({ cls: 'horizon-calendar-mini-count', text: String(projects.length) });
				}
				if (projects.some(project => project.deadline === date)) button.addClass('has-deadline');
				if (projects.some(project => this.context.warnings.some(warning => warning.projectId === project.id))) button.addClass('has-warning');
				const description = `${dateLabel(date, { dateStyle: 'full' })}${projects.length ? `: ${projects.map(project => project.title).join(', ')}` : ': no projects'}`;
				button.setAttribute('title', description);
				button.setAttribute('aria-label', description);
				this.registerDomEvent(button, 'click', () => this.context.navigate(date, 'day'));
				this.interactions.registerWeek(button, date, 1, false);
			}
		}
		this.root.createDiv({ cls: 'horizon-calendar-help', text: 'Select a month or date to see its projects. Drop an unplanned project on a date to plan it.' });
	}
}
