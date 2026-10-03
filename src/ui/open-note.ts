import type { Vault, WorkspaceLeaf } from 'obsidian';

export async function openNoteInCurrentTab(vault: Vault, leaf: WorkspaceLeaf, path: string, line?: number): Promise<void> {
	const file = vault.getFileByPath(path);
	if (!file) throw new Error('The note no longer exists.');
	if (line === undefined) {
		await leaf.openFile(file);
	} else {
		if (!Number.isInteger(line) || line < 0) throw new Error('Invalid note line.');
		await leaf.openFile(file, { active: true, eState: { line, focus: true } });
	}
}
