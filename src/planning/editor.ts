import { App, Component, Modal } from 'obsidian';
import { parseDate } from './dates';
import { planningWarnings } from './dependencies';
import type { PlanningProject, ProjectDates } from './types';

interface EditorOptions {
	project?: PlanningProject;
	projects: readonly PlanningProject[];
	dates?: ProjectDates;
	save: (title: string, dates: ProjectDates, dependencies: string[]) => Promise<void>;
	closed: () => void;
}

/** One date editor also makes every drag operation available to keyboard/touch users. */
export class PlanningEditor extends Modal {
	private bindings = new Component();
	private saving = false;

	constructor(app: App, private options: EditorOptions) { super(app); }

	onOpen(): void {
		this.bindings.load();
		this.contentEl.addClass('horizon-planning-editor');
		this.setTitle(this.options.project ? `Plan ${this.options.project.title}` : 'New project');
		const form = this.contentEl.createEl('form');
		const title = this.field(form, 'Project title', 'text');
		title.value = this.options.project?.title ?? '';
		title.required = true;
		if (this.options.project) title.disabled = true;
		const dates = this.options.dates ?? this.options.project ?? {};
		const start = this.field(form, 'Start date', 'date');
		start.value = dates.start ?? '';
		const deadline = this.field(form, 'Deadline', 'date');
		deadline.value = dates.deadline ?? '';
		form.createEl('p', { cls: 'horizon-planning-hint', text: this.options.project?.inline
			? 'Planning creates a project note beside the source note and links this line to it.'
			: 'Either date is enough. Clear both dates to leave this project unplanned.' });
		const selection = new Set(this.options.project?.dependencies.map(dependency => dependency.path ?? dependency.linkpath ?? dependency.title) ?? []);
		const group = form.createEl('fieldset', { cls: 'horizon-planning-dependencies' });
		group.createEl('legend', { text: 'Depends on' });
		const candidates = this.options.projects.filter(project => !project.inline && project.id !== this.options.project?.id);
		const choices = candidates.map(project => ({ value: project.path, title: project.title }));
		for (const dependency of this.options.project?.dependencies ?? []) {
			const value = dependency.path ?? dependency.linkpath ?? dependency.title;
			if (!choices.some(choice => choice.value === value)) choices.push({ value, title: `${dependency.title} (unavailable)` });
		}
		if (!choices.length) group.createEl('p', { cls: 'horizon-planning-hint', text: 'No other project notes yet.' });
		const warning = form.createDiv({ cls: 'horizon-planning-editor-warning', attr: { 'aria-live': 'polite' } });
		const preview = () => {
			deadline.min = start.value;
			warning.empty();
			const draft: PlanningProject = {
				id: this.options.project?.id ?? 'new-project', path: this.options.project?.path ?? '',
				title: title.value.trim(), status: this.options.project?.status ?? 'todo',
				start: parseDate(start.value), deadline: parseDate(deadline.value),
				dependencies: [...selection].map(path => ({ path, title: choices.find(choice => choice.value === path)?.title ?? path })),
			};
			const projects = [...this.options.projects.filter(project => project.id !== draft.id), draft];
			for (const item of planningWarnings(projects).filter(item => item.projectId === draft.id)) {
				warning.createEl('p', { text: item.message });
			}
		};
		for (const choice of choices) {
			const label = group.createEl('label', { cls: 'horizon-planning-dependency-choice' });
			const input = label.createEl('input', { type: 'checkbox' });
			input.checked = selection.has(choice.value);
			label.createSpan({ text: choice.title });
			this.bindings.registerDomEvent(input, 'change', () => {
				if (input.checked) selection.add(choice.value); else selection.delete(choice.value);
				preview();
			});
		}
		this.bindings.registerDomEvent(start, 'change', preview);
		this.bindings.registerDomEvent(deadline, 'change', preview);
		const error = form.createEl('p', { cls: 'horizon-planning-error', attr: { role: 'alert' } });
		const actions = form.createDiv({ cls: 'horizon-planning-editor-actions' });
		const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
		actions.createEl('button', { text: 'Save plan', cls: 'mod-cta', attr: { type: 'submit' } });
		this.bindings.registerDomEvent(cancel, 'click', () => this.close());
		this.bindings.registerDomEvent(form, 'submit', event => {
			event.preventDefault();
			if (this.saving) return;
			const planned: ProjectDates = { start: parseDate(start.value), deadline: parseDate(deadline.value) };
			if (!title.value.trim()) { error.setText('Enter a project title.'); return; }
			if ((start.value && !planned.start) || (deadline.value && !planned.deadline)) {
				error.setText('Enter a valid calendar date.'); return;
			}
			if (planned.start && planned.deadline && planned.deadline < planned.start) {
				error.setText('The deadline cannot be before the start date.'); return;
			}
			if (this.options.project?.inline && !planned.start && !planned.deadline) {
				error.setText('Choose at least one date to create a project note.'); return;
			}
			this.saving = true;
			for (const control of Array.from(form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button'))) control.disabled = true;
			void this.options.save(title.value.trim(), planned, [...selection]).then(() => this.close()).catch((cause: unknown) => {
				this.saving = false;
				for (const control of Array.from(form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button'))) control.disabled = false;
				if (this.options.project) title.disabled = true;
				error.setText(cause instanceof Error ? cause.message : 'Could not save the project plan.');
			});
		});
		preview();
		if (this.options.project) start.focus(); else title.focus();
	}

	onClose(): void {
		this.bindings.unload();
		this.contentEl.empty();
		this.options.closed();
	}

	private field(form: HTMLElement, text: string, type: string): HTMLInputElement {
		const label = form.createEl('label', { cls: 'horizon-planning-field' });
		label.createSpan({ text });
		return label.createEl('input', { type });
	}
}
