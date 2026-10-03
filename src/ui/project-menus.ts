import { App, Menu, Notice } from 'obsidian';
import { PROJECT_STATUSES, setProjectStatus } from './project-status';
import type { ProjectFilter } from './project-filter';

/** Both controls share native menu positioning, accessibility and cleanup. */
export class ProjectMenus {
	private menu: Menu | undefined;

	constructor(private app: App, private refresh: () => Promise<void>) {}

	close(): void { this.menu?.hide(); }

	openFilter(button: HTMLElement, event: MouseEvent, filter: ProjectFilter, select: (filter: ProjectFilter) => void): void {
		const menu = this.create(button);
		menu.addItem(item => item.setTitle('All').setIcon('list-filter').setChecked(filter === 'all')
			.onClick(() => select('all')));
		menu.addSeparator();
		for (const status of PROJECT_STATUSES) {
			menu.addItem(item => item.setTitle(status.tag).setIcon(status.icon).setChecked(filter === status.tag)
				.onClick(() => select(status.tag)));
		}
		this.show(menu, button, event);
	}

	openStatus(button: HTMLElement, event: MouseEvent): void {
		const path = button.getAttribute('data-note-path');
		if (!path) return;
		const lineValue = button.getAttribute('data-note-line');
		const target = {
			path, line: lineValue === null ? undefined : Number(lineValue),
			sourceLine: button.getAttribute('data-source-line') ?? undefined,
		};
		const menu = this.create(button);
		for (const status of PROJECT_STATUSES) {
			menu.addItem(item => item.setTitle(status.tag).setIcon(status.icon)
				.setChecked(status.tag === button.getAttribute('data-project-status')).onClick(() => {
				void setProjectStatus(this.app, target, status.tag).then(this.refresh).catch((error: unknown) => {
					console.error('horizon: could not update project status', error);
					new Notice(error instanceof Error ? error.message : 'Could not update project status.');
				});
			}));
		}
		this.show(menu, button, event);
	}

	private create(button: HTMLElement): Menu {
		this.close();
		const menu = new Menu();
		this.menu = menu;
		button.setAttribute('aria-expanded', 'true');
		menu.onHide(() => {
			button.setAttribute('aria-expanded', 'false');
			if (this.menu === menu) this.menu = undefined;
		});
		return menu;
	}

	private show(menu: Menu, button: HTMLElement, event: MouseEvent): void {
		if (event.detail > 0) menu.showAtMouseEvent(event);
		else {
			const bounds = button.getBoundingClientRect();
			menu.showAtPosition({ x: bounds.left, y: bounds.bottom }, button.ownerDocument);
		}
	}
}
