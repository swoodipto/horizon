import type { Workspace, WorkspaceLeaf } from 'obsidian';

export async function openNotesInCenter(workspace: Workspace, viewType: string, optionId: string): Promise<WorkspaceLeaf> {
	let matching: WorkspaceLeaf | undefined;
	let reusable: WorkspaceLeaf | undefined;
	workspace.iterateRootLeaves((candidate) => {
		const state = candidate.getViewState();
		if (state.type !== viewType) return;
		if (!reusable) reusable = candidate;
		if (!matching && state.state?.optionId === optionId) matching = candidate;
	});
	let leaf = matching ?? reusable;
	if (!leaf) {
		const recent = workspace.getMostRecentLeaf();
		leaf = recent?.getViewState().type === 'empty' ? recent : workspace.getLeaf('tab');
	}
	if (leaf !== matching) await leaf.setViewState({ type: viewType, state: { optionId }, active: true });
	await workspace.revealLeaf(leaf);
	workspace.setActiveLeaf(leaf, { focus: true });
	return leaf;
}
