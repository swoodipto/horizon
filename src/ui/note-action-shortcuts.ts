/** Shared shortcuts: Option on macOS is Alt on Windows. */
export const NOTE_ACTION_SHORTCUTS = {
	parent: { key: 'p', modifier: 'alt' },
	dependent: { key: 'd', modifier: 'alt' },
	deadline: { key: 'd', modifier: 'shift' },
	status: { key: 'a', modifier: 'shift' },
	start: { key: 's', modifier: 'shift' },
	later: { key: 'h', modifier: 'shift' },
} as const;

export function noteActionShortcut(action: keyof typeof NOTE_ACTION_SHORTCUTS): string {
	const shortcut = NOTE_ACTION_SHORTCUTS[action];
	return `${shortcut.modifier === 'alt' ? 'Alt' : 'Shift'}+${shortcut.key.toUpperCase()}`;
}
