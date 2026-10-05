import { SIDEBAR_SECTIONS, type SidebarOption } from './sidebar-options';

export interface OptionShortcut {
	option: SidebarOption;
	key: string;
}

// Reserve established keys before assigning new options. Definition order
// resolves duplicate reservations and automatic keys; label letters provide
// fallbacks, so new options need no key config.
export function buildOptionShortcuts(options: readonly SidebarOption[]): OptionShortcut[] {
	const usedKeys = new Set<string>();
	const reservedKeys = options.map(option => {
		const key = option.shortcut?.toLowerCase();
		if (!key || !/^[a-z]$/.test(key) || usedKeys.has(key)) return undefined;
		usedKeys.add(key);
		return key;
	});
	const shortcuts: OptionShortcut[] = [];
	for (const [index, option] of options.entries()) {
		const letters = option.label.toLowerCase().match(/[a-z]/g) ?? [];
		const key = reservedKeys[index] ?? letters.find(letter => !usedKeys.has(letter));
		if (!key) continue;
		usedKeys.add(key);
		shortcuts.push({ option, key });
	}
	return shortcuts;
}

export const OPTION_SHORTCUTS: readonly OptionShortcut[] = buildOptionShortcuts(
	SIDEBAR_SECTIONS.flatMap(section => section.options),
);

const shortcutsById = new Map(OPTION_SHORTCUTS.map(({ option, key }) => [option.id, key]));
const optionsByKey = new Map(OPTION_SHORTCUTS.map(({ option, key }) => [key, option]));

export function shortcutForOption(id: string): string | undefined {
	return shortcutsById.get(id);
}

export function optionForShortcut(key: string): SidebarOption | undefined {
	return optionsByKey.get(key.toLowerCase());
}
