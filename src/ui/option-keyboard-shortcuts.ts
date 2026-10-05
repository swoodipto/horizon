import { Component } from 'obsidian';
import { optionForShortcut } from './option-shortcuts';
import type { SidebarOption } from './sidebar-options';

interface OptionShortcutContext {
	isActive: () => boolean;
	isBlocked?: () => boolean;
	activate: (option: SidebarOption) => void;
}

/** Share option shortcuts between Horizon views while leaving editing untouched. */
export class OptionKeyboardShortcuts extends Component {
	constructor(root: HTMLElement, context: OptionShortcutContext) {
		super();
		this.registerDomEvent(root.ownerDocument, 'keydown', event => {
			if (event.defaultPrevented || event.isComposing || event.repeat ||
				event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || context.isBlocked?.()) return;
			const option = optionForShortcut(event.key);
			if (!option) return;
			const target = event.target as HTMLElement | null;
			const doc = root.ownerDocument;
			if (!target || target.isContentEditable ||
				target.closest('input, textarea, select, [role="textbox"], [role="dialog"], [role="menu"]')) return;
			const inRoot = root.contains(target);
			const fromDocument = target === doc.body || target === doc.documentElement;
			if (!inRoot && (!fromDocument || !context.isActive())) return;
			// Native menus and modals can keep focus on their original view control.
			if (Array.from(doc.querySelectorAll<HTMLElement>('.modal-container, .menu'))
				.some(overlay => overlay.getClientRects().length > 0)) return;
			event.preventDefault();
			event.stopPropagation();
			context.activate(option);
		});
	}
}
