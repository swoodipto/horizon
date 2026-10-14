import { Component, Platform, Scope, type App, type Hotkey, type Modifier } from 'obsidian';

const TOGGLE_TASK_COMMAND = 'editor:toggle-checklist-status';

interface NativeHotkeyManager {
	getHotkeys?: (command: string) => Hotkey[] | undefined;
	getDefaultHotkeys?: (command: string) => Hotkey[] | undefined;
}

/** Obsidian does not expose this lookup in its public types; read it without changing native bindings. */
export function taskToggleHotkeys(app: App): readonly Hotkey[] {
	const manager = (app as App & { hotkeyManager?: NativeHotkeyManager }).hotkeyManager;
	return manager?.getHotkeys?.(TOGGLE_TASK_COMMAND) ?? manager?.getDefaultHotkeys?.(TOGGLE_TASK_COMMAND) ?? [];
}

export function matchesHotkey(event: KeyboardEvent, hotkey: Hotkey): boolean {
	const key = ((hotkey as Hotkey & { code?: string }).code ?? hotkey.key)?.toLowerCase();
	if (!key || (event.key.toLowerCase() !== key && event.code.toLowerCase() !== key &&
		!(key.length === 1 && event.code.toLowerCase() === `key${key}`))) return false;
	const modifiers = new Set<Modifier>(hotkey.modifiers.map(modifier => modifier === 'Mod'
		? Platform.isMacOS ? 'Meta' : 'Ctrl' : modifier));
	return event.ctrlKey === modifiers.has('Ctrl') && event.metaKey === modifiers.has('Meta') &&
		event.altKey === modifiers.has('Alt') && event.shiftKey === modifiers.has('Shift');
}

/** Reuse the user's native task hotkey for the focused or selected task row. */
export class TaskToggleKeyboard extends Component {
	private readonly scope: Scope;
	private active = false;

	constructor(private app: App, private root: HTMLElement, private enabled: () => boolean,
		private hotkeys: () => readonly Hotkey[]) {
		super();
		const doc = root.ownerDocument;
		this.scope = new Scope(app.scope);
		// Obsidian receives keydown on window capture, before document listeners.
		// A wildcard scope can read remapped hotkeys at the time of each press.
		this.scope.register(null, null, event => {
			if (!this.enabled() || event.repeat || event.isComposing ||
				!this.hotkeys().some(hotkey => matchesHotkey(event, hotkey))) return;
			const target = event.target as HTMLElement | null;
			if (!target || target.isContentEditable ||
				target.closest('textarea, select, [role="textbox"], input:not(.horizon-task-checkbox)')) return;
			if (Array.from(doc.querySelectorAll<HTMLElement>('.menu, .modal-container'))
				.some(overlay => overlay.getClientRects().length > 0)) return;
			let row = target.closest<HTMLElement>('.horizon-task-item');
			if (!row && (target === root || target === doc.body || target === doc.documentElement)) {
				const selected = root.querySelectorAll<HTMLElement>('.horizon-task-item a.horizon-note-link.is-selected');
				if (selected.length === 1) row = selected[0]?.closest<HTMLElement>('.horizon-task-item') ?? null;
			}
			if (!row || !root.contains(row)) return;
			const checkbox = row.querySelector<HTMLInputElement>('input.horizon-task-checkbox');
			if (!checkbox || checkbox.disabled) return;
			checkbox.click();
			return false;
		});
		this.registerEvent(app.workspace.on('active-leaf-change', () => this.sync()));
		this.register(() => this.deactivate());
		this.sync();
	}

	sync(): void {
		const shouldActivate = this.enabled();
		if (shouldActivate === this.active) return;
		if (shouldActivate) {
			this.app.keymap.pushScope(this.scope);
			this.active = true;
		} else this.deactivate();
	}

	private deactivate(): void {
		if (!this.active) return;
		this.app.keymap.popScope(this.scope);
		this.active = false;
	}
}
