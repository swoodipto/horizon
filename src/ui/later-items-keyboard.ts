import { Component } from 'obsidian';
import { NOTE_ACTION_SHORTCUTS } from './note-action-shortcuts';

/** Toggle later items within the active Projects view, outside editors and overlays. */
export class LaterItemsKeyboard extends Component {
	constructor(root: HTMLElement, enabled: () => boolean, toggle: () => boolean) {
		super();
		const doc = root.ownerDocument;
		const shortcut = NOTE_ACTION_SHORTCUTS.later;
		this.registerDomEvent(doc, 'keydown', event => {
			if (event.defaultPrevented || event.isComposing || event.repeat || !event.shiftKey ||
				event.altKey || event.ctrlKey || event.metaKey || !enabled() ||
				(event.code !== `Key${shortcut.key.toUpperCase()}` && event.key.toLowerCase() !== shortcut.key)) return;
			const target = event.target as HTMLElement | null;
			if (!target || (!root.contains(target) && target !== doc.body && target !== doc.documentElement) ||
				target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]')) return;
			if (Array.from(doc.querySelectorAll<HTMLElement>('.menu, .modal-container'))
				.some(overlay => overlay.getClientRects().length > 0)) return;
			if (!toggle()) return;
			event.preventDefault();
			event.stopPropagation();
		}, true);
	}
}
