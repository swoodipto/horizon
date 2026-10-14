import type { App } from 'obsidian';

export interface TaskCheckboxTarget { path: string; line: number; sourceLine: string }

/** Replace only one still-open checkbox, preserving line endings and other text. */
export function completeTaskSource(content: string, target: TaskCheckboxTarget): string {
	if (!Number.isInteger(target.line) || target.line < 0 || !target.sourceLine) throw new Error('Invalid task line.');
	const parts = content.split(/(\r?\n)/);
	let index = target.line * 2;
	if (parts[index] !== target.sourceLine) {
		const matches: number[] = [];
		for (let i = 0; i < parts.length; i += 2) if (parts[i] === target.sourceLine) matches.push(i);
		if (matches.length !== 1) throw new Error('The task changed. Reopen Tasks and try again.');
		index = matches[0] ?? -1;
	}
	const line = parts[index];
	if (line === undefined) throw new Error('The task no longer exists.');
	const checkbox = /^(?:\s*>\s*)*\s*(?:[-+*]|\d+[.)])\s+\[ \]/.exec(line);
	if (!checkbox) throw new Error('The task is no longer open. Reopen Tasks and try again.');
	parts[index] = line.slice(0, checkbox[0].length - 2) + 'x]' + line.slice(checkbox[0].length);
	return parts.join('');
}

export async function completeTaskCheckbox(app: Pick<App, 'vault'>, target: TaskCheckboxTarget): Promise<void> {
	const file = app.vault.getFileByPath(target.path);
	if (!file) throw new Error('The note no longer exists.');
	await app.vault.process(file, content => completeTaskSource(content, target));
}
