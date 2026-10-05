import { Component } from 'obsidian';

interface RowActionOptions {
	key: string;
	modifier?: 'shift' | 'alt';
	row: string;
	button: string;
	enabled: () => boolean;
	open: (button: HTMLElement) => void;
}

/** Row shortcuts pause during editing and use physical keys for macOS Option characters. */
export class RowActionKeyboard extends Component {
	constructor(root: HTMLElement, options: RowActionOptions) {
		super();
		this.registerDomEvent(root.ownerDocument, 'keydown', event => {
			const modifierMatches = options.modifier === 'alt'
				? event.altKey && !event.shiftKey : event.shiftKey && !event.altKey;
			const keyMatches = event.code === `Key${options.key.toUpperCase()}` || event.key.toLowerCase() === options.key;
			if (event.defaultPrevented || event.isComposing || event.repeat || !modifierMatches ||
				event.ctrlKey || event.metaKey || !keyMatches || !options.enabled()) return;
			const target = event.target as HTMLElement | null;
			if (!target || !root.contains(target) || target.isContentEditable ||
				target.closest('input, textarea, select, [role="textbox"]')) return;
			if (Array.from(root.ownerDocument.querySelectorAll<HTMLElement>('.menu, .modal-container'))
				.some(overlay => overlay.getClientRects().length > 0)) return;
			const button = target.closest(options.row)?.querySelector<HTMLElement>(options.button);
			if (!button) return;
			event.preventDefault();
			event.stopPropagation();
			options.open(button);
		});
	}
}
