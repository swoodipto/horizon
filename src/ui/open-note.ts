import type { Vault, Workspace, WorkspaceLeaf } from 'obsidian';

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

/** Focus an existing note tab before replacing a Horizon results tab or creating another tab. */
export async function openNoteFromSidebar(workspace: Workspace, vault: Vault, resultsViewType: string,
	path: string, line?: number): Promise<WorkspaceLeaf> {
	if (!vault.getFileByPath(path)) throw new Error('The note no longer exists.');
	if (line !== undefined && (!Number.isInteger(line) || line < 0)) throw new Error('Invalid note line.');
	const existing = workspace.getLeavesOfType('markdown').find(leaf => leaf.getViewState().state?.file === path);
	const leaf = existing ?? workspace.getLeavesOfType(resultsViewType)[0] ?? workspace.getLeaf('tab');
	if (!existing || line !== undefined) await openNoteInCurrentTab(vault, leaf, path, line);
	await workspace.revealLeaf(leaf);
	workspace.setActiveLeaf(leaf, { focus: true });
	return leaf;
}
