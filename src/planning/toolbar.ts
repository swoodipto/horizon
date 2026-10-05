import { Component, setIcon } from 'obsidian';
import { addDays, addMonths, today } from './dates';
import { CALENDAR_MODES, TIMELINE_SCALES, type PlanningState } from './state';

interface ToolbarActions {
	change: (state: PlanningState) => void;
	zoom: (delta: number) => void;
	create: () => void;
}

export class PlanningToolbar extends Component {
	constructor(private host: HTMLElement, private state: PlanningState, private actions: ToolbarActions) { super(); }

	onload(): void {
		const header = this.host.createDiv({ cls: 'horizon-planning-heading' });
		header.createEl('h2', { text: this.state.optionId === 'timeline' ? 'Timeline' : 'Upcoming' });
		const add = header.createEl('button', { text: 'New project', attr: { type: 'button' } });
		this.registerDomEvent(add, 'click', () => this.actions.create());
		const toolbar = this.host.createDiv({ cls: 'horizon-planning-toolbar', attr: { 'aria-label': 'Planning view' } });
		const previous = this.iconButton(toolbar, 'chevron-left', 'Previous period');
		const next = this.iconButton(toolbar, 'chevron-right', 'Next period');
		const now = toolbar.createEl('button', { text: 'Today', attr: { type: 'button' } });
		this.registerDomEvent(previous, 'click', () => this.move(-1));
		this.registerDomEvent(next, 'click', () => this.move(1));
		this.registerDomEvent(now, 'click', () => this.actions.change({ ...this.state, date: today() }));
		const label = toolbar.createEl('label', { cls: 'horizon-planning-date-label' });
		label.createSpan({ cls: 'horizon-sr-only', text: 'Visible date' });
		const date = label.createEl('input', { type: 'date', value: this.state.date });
		this.registerDomEvent(date, 'change', () => {
			if (date.value && date.checkValidity()) this.actions.change({ ...this.state, date: date.value });
		});
		const modeLabel = toolbar.createEl('label');
		modeLabel.createSpan({ cls: 'horizon-sr-only', text: 'View' });
		const select = modeLabel.createEl('select');
		if (this.state.optionId === 'timeline') {
			for (const mode of TIMELINE_SCALES) select.createEl('option', { text: mode.label, value: mode.value });
			select.value = this.state.scale;
			this.registerDomEvent(select, 'change', () => {
				const scale = TIMELINE_SCALES.find(item => item.value === select.value)?.value;
				if (scale) this.actions.change({ ...this.state, scale, zoom: 1 });
			});
			const out = this.iconButton(toolbar, 'minus', 'Zoom out');
			const into = this.iconButton(toolbar, 'plus', 'Zoom in');
			this.registerDomEvent(out, 'click', () => this.actions.zoom(-1));
			this.registerDomEvent(into, 'click', () => this.actions.zoom(1));
		} else {
			for (const mode of CALENDAR_MODES) select.createEl('option', { text: mode.label, value: mode.value });
			select.value = this.state.mode;
			this.registerDomEvent(select, 'change', () => {
				const mode = CALENDAR_MODES.find(item => item.value === select.value)?.value;
				if (mode) this.actions.change({ ...this.state, mode });
			});
		}
	}

	private iconButton(host: HTMLElement, icon: string, title: string): HTMLButtonElement {
		const button = host.createEl('button', { cls: 'horizon-planning-icon-button', attr: {
			type: 'button', 'aria-label': title, title,
		} });
		setIcon(button, icon);
		return button;
	}

	private move(direction: number): void {
		let date: string;
		if (this.state.optionId === 'timeline') {
			const months = { month: 1, quarter: 3, year: 12, 'five-years': 60 }[this.state.scale];
			date = addMonths(this.state.date, direction * months);
		} else if (this.state.mode === 'month' || this.state.mode === 'year') {
			date = addMonths(this.state.date, direction * (this.state.mode === 'year' ? 12 : 1));
		} else {
			const days = { day: 1, 'four-days': 4, week: 7 }[this.state.mode];
			date = addDays(this.state.date, direction * days);
		}
		this.actions.change({ ...this.state, date });
	}
}
