import { Component, Menu, setIcon } from 'obsidian';
import type { BoardPreferences } from './project-board-model';

export class ProjectViewControls extends Component {
	private menu?: Menu;
	constructor(private root: HTMLElement, private active: () => boolean,
		private preferences: () => BoardPreferences, private change: (next: BoardPreferences) => void) {
		super();
		this.register(() => this.menu?.hide());
		this.registerDomEvent(root.ownerDocument, 'keydown', event => {
			if (event.defaultPrevented || event.isComposing || event.repeat || !event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || !active()) return;
			const key = event.code === 'KeyL' ? 'l' : event.code === 'KeyK' ? 'k' : event.key.toLowerCase();
			if (key !== 'l' && key !== 'k') return;
			const target = event.target as HTMLElement | null;
			const doc = root.ownerDocument;
			if (!target || target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [role="menu"], [role="dialog"]') ||
				(!root.contains(target) && target !== doc.body && target !== doc.documentElement) ||
				Array.from(doc.querySelectorAll<HTMLElement>('.menu, .modal-container')).some(el => el.getClientRects().length)) return;
			event.preventDefault(); event.stopPropagation();
			change({ ...preferences(), mode: key === 'l' ? 'list' : 'kanban' });
		});
	}
	render(heading: HTMLElement): void {
		const button = heading.createEl('button', { cls: 'clickable-icon horizon-view-switch',
			attr: { type: 'button', 'aria-label': 'Project view options', 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
		setIcon(button, this.preferences().mode === 'kanban' ? 'columns-3' : 'list');
		button.onclick = () => {
			this.menu?.hide();
			const menu = new Menu(); this.menu = menu;
			button.setAttribute('aria-expanded', 'true');
			for (const mode of ['list', 'kanban'] as const) menu.addItem(item => item
				.setTitle(mode === 'list' ? 'List' : 'Kanban').setIcon(mode === 'list' ? 'list' : 'columns-3')
				.setChecked(this.preferences().mode === mode)
				.onClick(() => this.change({ ...this.preferences(), mode })));
			if (this.preferences().mode === 'kanban') {
				menu.addSeparator();
				menu.addItem(item => item.setTitle('Swimlanes').setChecked(this.preferences().swimlanes)
					.onClick(() => this.change({ ...this.preferences(), swimlanes: !this.preferences().swimlanes })));
				menu.addItem(item => item.setTitle('Hide empty columns').setChecked(this.preferences().hideEmpty)
					.onClick(() => this.change({ ...this.preferences(), hideEmpty: !this.preferences().hideEmpty })));
			}
			menu.onHide(() => { button.setAttribute('aria-expanded', 'false'); if (this.menu === menu) this.menu = undefined; });
			const rect = button.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
		};
	}
}
