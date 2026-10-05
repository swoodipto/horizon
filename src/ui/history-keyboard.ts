import { Component, Platform } from 'obsidian';

/** History shortcuts belong to Horizon navigation, never note/input editing. */
export class HistoryKeyboard extends Component {
	constructor(root: HTMLElement, enabled: () => boolean, replay: (redo: boolean) => void) {
		super();
		const doc = root.ownerDocument;
		this.registerDomEvent(doc, 'keydown', event => {
			const modifier = Platform.isMacOS ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
			if (!modifier || event.altKey || event.repeat || event.isComposing || event.defaultPrevented ||
				(event.code !== 'KeyZ' && event.key.toLowerCase() !== 'z') || !enabled()) return;
			const target = event.target as HTMLElement | null;
			if (!target || (!root.contains(target) && target !== doc.body && target !== doc.documentElement) ||
				target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]')) return;
			if (Array.from(doc.querySelectorAll<HTMLElement>('.menu, .modal-container'))
				.some(overlay => overlay.getClientRects().length > 0)) return;
			event.preventDefault(); event.stopPropagation();
			replay(event.shiftKey);
		}, true);
	}
}
