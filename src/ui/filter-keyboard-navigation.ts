import { Component } from 'obsidian';

/** Horizontal arrows filter only the active Horizon results view. */
export class FilterKeyboardNavigation extends Component {
	constructor(root: HTMLElement, enabled: () => boolean, step: (direction: -1 | 1, multiple: boolean) => boolean) {
		super();
		const doc = root.ownerDocument;
		this.registerDomEvent(doc, 'keydown', event => {
			if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || event.defaultPrevented ||
				event.isComposing || event.altKey || event.ctrlKey || event.metaKey || !enabled()) return;
			const target = event.target as HTMLElement | null;
			if (!target || (!root.contains(target) && target !== doc.body && target !== doc.documentElement) ||
				target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]')) return;
			if (Array.from(root.ownerDocument.querySelectorAll<HTMLElement>('.menu, .modal-container'))
				.some(overlay => overlay.getClientRects().length > 0)) return;
			if (!step(event.key === 'ArrowRight' ? 1 : -1, event.shiftKey)) return;
			event.preventDefault();
			event.stopPropagation();
		}, true);
	}
}
