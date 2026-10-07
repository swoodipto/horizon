import type { Workspace, WorkspaceLeaf } from 'obsidian';

export async function openNotesInCenter(workspace: Workspace, viewType: string, optionId: string): Promise<WorkspaceLeaf> {
	let leaf: WorkspaceLeaf | undefined;
	workspace.iterateRootLeaves((candidate) => {
		if (!leaf && candidate.getViewState().type === viewType) leaf = candidate;
	});
	if (!leaf) {
		const recent = workspace.getMostRecentLeaf();
		leaf = recent?.getViewState().type === 'empty' ? recent : workspace.getLeaf('tab');
	}
	await leaf.setViewState({ type: viewType, state: { optionId }, active: true });
	await workspace.revealLeaf(leaf);
	workspace.setActiveLeaf(leaf, { focus: true });
	return leaf;
}
