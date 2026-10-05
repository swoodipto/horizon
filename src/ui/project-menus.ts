import type { NoteActionHistory } from './note-action-history';
import { App, Menu, Notice, setIcon } from 'obsidian';
import { PROJECT_STATUSES, setProjectStatus } from './project-status';
import { applyToItems } from './bulk-note-actions';
import { PROJECT_STATUS_SHORTCUTS } from './project-status-shortcuts';

/** Native project status editing, with shared positioning and cleanup. */
export class ProjectMenus {
	private menu: Menu | undefined;

	constructor(private app: App, private refresh: () => Promise<void>, private history: NoteActionHistory) {}

	get isOpen(): boolean { return this.menu !== undefined; }

	close(): void { this.menu?.hide(); }

	openStatus(button: HTMLElement, event?: MouseEvent, buttons: HTMLElement[] = [button]): void {
		const path = button.getAttribute('data-note-path');
		if (!path) return;
		const targets = buttons.map(item => ({
			path: item.getAttribute('data-note-path') ?? '',
			line: item.getAttribute('data-note-line') === null ? undefined : Number(item.getAttribute('data-note-line')),
			sourceLine: item.getAttribute('data-source-line') ?? undefined,
		})).filter(item => item.path);

		let removeShortcutListener: (() => void) | undefined;
		const menu = this.create(button, () => removeShortcutListener?.());
		const selectStatus = (tag: string) => {
			menu.hide();
			void this.history.record(app => applyToItems(targets, target => setProjectStatus(app, target, tag))).then(this.refresh).catch((error: unknown) => {
				void this.refresh();
				console.error('horizon: could not update project status', error);
				new Notice(error instanceof Error ? error.message : 'Could not update project status.');
			});
		};
		for (const status of PROJECT_STATUSES) {
			const key = PROJECT_STATUS_SHORTCUTS.find(shortcut => shortcut.status === status.tag)?.key;
			const title = button.ownerDocument.createDocumentFragment();
			const label = button.ownerDocument.createElement('span');
			label.className = 'horizon-status-menu-label';
			const text = button.ownerDocument.createElement('span');
			text.textContent = status.tag;
			const hint = button.ownerDocument.createElement('span');
			hint.className = 'horizon-status-menu-shortcut';
			hint.textContent = key?.toUpperCase() ?? '';
			const icon = button.ownerDocument.createElement('span');
			icon.className = 'horizon-status-menu-icon';
			setIcon(icon, status.icon);
			label.append(hint, icon, text);
			title.append(label);
			menu.addItem(item => item.setTitle(title)
				.setChecked(buttons.every(item => status.tag === item.getAttribute('data-project-status')))
				.onClick(() => selectStatus(status.tag)));
		}
		const doc = button.ownerDocument;
		const onKeydown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey ||
				event.metaKey || event.altKey || this.menu !== menu) return;
			const focused = event.target as HTMLElement | null;
			if (focused?.isContentEditable || focused?.closest('input, textarea, select, [role="textbox"]')) return;
			const shortcut = PROJECT_STATUS_SHORTCUTS.find(item => item.key === event.key.toLowerCase());
			if (!shortcut) return;
			event.preventDefault();
			event.stopPropagation();
			selectStatus(shortcut.status);
		};
		this.show(menu, button, event);
		menu.registerDomEvent(doc, 'keydown', onKeydown, true);
		removeShortcutListener = () => doc.removeEventListener('keydown', onKeydown, true);
	}

	private create(button: HTMLElement, cleanup: () => void): Menu {
		this.close();
		const menu = new Menu();
		menu.setUseNativeMenu(false);
		this.menu = menu;
		const focused = button.ownerDocument.activeElement as HTMLElement | null;
		button.setAttribute('aria-expanded', 'true');
		menu.onHide(() => {
			cleanup();
			button.setAttribute('aria-expanded', 'false');
			if (this.menu === menu) this.menu = undefined;
			const active = button.ownerDocument.activeElement;
			if (focused?.isConnected && (active === button.ownerDocument.body || active === button ||
				(active as HTMLElement | null)?.closest('.menu'))) focused.focus({ preventScroll: true });
		});
		return menu;
	}

	private show(menu: Menu, button: HTMLElement, event?: MouseEvent): void {
		if (event && event.detail > 0) menu.showAtMouseEvent(event);
		else {
			const bounds = button.getBoundingClientRect();
			menu.showAtPosition({ x: bounds.left, y: bounds.bottom }, button.ownerDocument);
		}
	}
}
