import { RowActionKeyboard } from './row-action-keyboard';
import { NOTE_ACTION_SHORTCUTS } from './note-action-shortcuts';

/** Open status editing for the focused project, without intercepting note typing. */
export class ProjectStatusKeyboard extends RowActionKeyboard {
	constructor(root: HTMLElement, enabled: () => boolean, open: (button: HTMLElement) => void) {
		super(root, { ...NOTE_ACTION_SHORTCUTS.status, row: '.horizon-project-row', button: 'button.horizon-project-status', enabled, open });
	}
}
