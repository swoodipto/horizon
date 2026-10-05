import { Component } from 'obsidian';
import { projectRange } from './dates';
import type { PlanningRenderContext } from './types';

export class UnscheduledProjects extends Component {
	constructor(private host: HTMLElement, private context: PlanningRenderContext) { super(); }

	onload(): void {
		const projects = this.context.projects.filter(project => {
			const range = projectRange(project);
			return !range || range.end < range.start;
		});
		if (!projects.length) return;
		const section = this.host.createEl('details', { cls: 'horizon-planning-unscheduled' });
		section.open = true;
		section.createEl('summary', { text: `Needs planning (${projects.length})` });
		section.createEl('p', { cls: 'horizon-planning-hint',
			text: 'Choose dates or drag a project onto a calendar date. Inline projects become project notes when planned.' });
		const list = section.createDiv({ cls: 'horizon-planning-undated-list' });
		for (const project of projects) {
			const item = list.createDiv({ cls: 'horizon-planning-undated', attr: { 'data-project-id': project.id } });
			item.draggable = true;
			const title = item.createEl('button', { text: project.title, cls: 'horizon-planning-project-title', attr: { type: 'button' } });
			const plan = item.createEl('button', { text: 'Plan', attr: { type: 'button', 'aria-label': `Plan ${project.title}` } });
			if (project.inline) item.createSpan({ text: 'Inline', cls: 'horizon-planning-inline-label' });
			this.registerDomEvent(title, 'click', () => this.context.open(project));
			this.registerDomEvent(plan, 'click', () => this.context.edit(project));
			this.registerDomEvent(item, 'dragstart', event => {
				event.dataTransfer?.setData('application/x-horizon-project', project.id);
				if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
			});
		}
	}
}
