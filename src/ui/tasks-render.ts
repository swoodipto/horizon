import type { OpenProjectTask, ProjectTaskGroup } from './tasks-model';

/** Render inside the shared category-list wrapper and its native title row. */
export function renderOpenTaskGroups<T extends { path: string }>(
	results: HTMLElement,
	groups: readonly ProjectTaskGroup<T>[],
	registerCheckbox: (checkbox: HTMLInputElement, task: OpenProjectTask<T>) => void,
): void {
	results.empty();
	const heading = results.createDiv({ cls: 'inline-title horizon-results-heading' });
	heading.createEl('h3', { cls: 'horizon-inline-title horizon-no-select', text: 'Tasks' });
	heading.createSpan({ cls: 'horizon-note-count', text: String(groups.reduce((total, group) => total + group.tasks.length, 0)) });
	if (!groups.length) {
		results.createEl('p', { cls: 'horizon-empty-state', text: 'No open project tasks.' });
		return;
	}
	for (const group of groups) {
		const { project } = group;
		const section = results.createEl('section', { cls: 'horizon-task-group', attr: { 'aria-label': project.text } });
		const pill = section.createEl('a', { cls: 'horizon-task-project',
			attr: { href: project.file.path, 'data-note-path': project.file.path, 'aria-label': `Open project: ${project.text}` },
		});
		if (project.line !== undefined) pill.setAttribute('data-note-line', String(project.line));
		pill.createSpan({ text: project.text });
		const list = section.createEl('ul', { cls: 'horizon-note-list horizon-task-list' });
		for (const task of group.tasks) {
			const taskLabel = task.heading ? `${task.text}, under ${task.heading}` : task.text;
			const item = list.createEl('li', { cls: 'horizon-note-item horizon-task-item' });
			const checkboxWrap = item.createSpan({ cls: 'horizon-task-checkbox-wrap' });
			const checkbox = checkboxWrap.createEl('input', { cls: 'task-list-item-checkbox horizon-task-checkbox', type: 'checkbox',
				attr: { 'aria-label': `Complete task: ${taskLabel}`,
					'data-note-path': task.file.path, 'data-note-line': String(task.line) } });
			registerCheckbox(checkbox, task);
			const link = item.createEl('a', { cls: 'horizon-note-link',
				attr: { href: task.file.path, 'data-note-path': task.file.path, 'data-note-line': String(task.line),
					'aria-label': `Open task: ${taskLabel}` },
			});
			const text = link.createDiv({ cls: 'horizon-note-text' });
			text.createSpan({ cls: 'horizon-note-title', text: task.text });
			if (task.heading) text.createSpan({ cls: 'horizon-note-subtitle horizon-note-parent-name', text: task.heading });
		}
	}
}
