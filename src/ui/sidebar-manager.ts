import type { View, ViewState, Workspace, WorkspaceLeaf } from 'obsidian';

/** Owns a single sidebar leaf, including leaves being restored during reload. */
export class SidebarManager {
	private enabled = true;
	private started = false;
	private timer: number | undefined;
	private operation = Promise.resolve();
	private resolveReady!: () => void;
	private ready = new Promise<void>((resolve) => { this.resolveReady = resolve; });
	private restoringLeaves = new Map<WorkspaceLeaf, ViewState>();

	constructor(
		private workspace: Workspace,
		private viewType: string,
		private createView: (leaf: WorkspaceLeaf) => View,
		private isSidebarView: (view: View) => boolean,
	) {
		// Capture identities before registerView temporarily replaces views with empty ones.
		for (const leaf of workspace.getLeavesOfType(viewType)) {
			this.restoringLeaves.set(leaf, leaf.getViewState());
		}
	}

	start(): void {
		if (!this.enabled || this.started) return;
		this.started = true;
		// Our static view's open/close promises and Obsidian's registration handlers
		// complete in microtasks. Wait for them before inspecting or changing leaves.
		this.timer = window.setTimeout(() => { this.resolveReady(); }, 0);
	}

	dispose(): void {
		this.enabled = false;
		window.clearTimeout(this.timer);
		this.restoringLeaves.clear();
		this.resolveReady();
	}

	open(reveal: boolean): Promise<void> {
		const next = this.operation.then(() => this.ensureSingleLeaf(reveal));
		// Keep subsequent requests usable if one operation fails.
		this.operation = next.catch(() => {});
		return next;
	}

	private candidates(): WorkspaceLeaf[] {
		const leaves: WorkspaceLeaf[] = [];
		this.workspace.iterateAllLeaves((leaf) => {
			const type = leaf.getViewState().type;
			if (type === this.viewType || (type === 'empty' && this.restoringLeaves.has(leaf))) {
				leaves.push(leaf);
			}
		});
		return leaves;
	}

	private async ensureSingleLeaf(reveal: boolean): Promise<void> {
		await this.ready;
		if (!this.enabled) return;

		const candidates = this.candidates();
		const recent = this.workspace.getMostRecentLeaf(this.workspace.leftSplit);
		let leaf = recent && candidates.includes(recent)
			? recent
			: candidates.find((candidate) => this.isSidebarView(candidate.view)) ?? candidates[0];

		if (!leaf) {
			leaf = this.workspace.getLeftLeaf(false) ?? undefined;
			if (!leaf) throw new Error('No left sidebar leaf is available.');
			await leaf.setViewState({ type: this.viewType, active: false });
		} else {
			await leaf.loadIfDeferred();
			if (!this.enabled) return;
			// A ghost still reports the correct type, so setViewState alone cannot repair it.
			if (!this.isSidebarView(leaf.view)) {
				const state = this.restoringLeaves.get(leaf) ?? leaf.getViewState();
				await leaf.open(this.createView(leaf));
				if (!this.enabled) return;
				await leaf.setViewState({ ...state, type: this.viewType, active: false });
			}
		}

		if (!this.enabled) return;
		for (const duplicate of this.candidates()) {
			if (duplicate !== leaf) duplicate.detach();
		}
		this.restoringLeaves.clear();
		this.workspace.requestSaveLayout();

		if (reveal) {
			await this.workspace.revealLeaf(leaf);
			if (this.enabled) this.workspace.setActiveLeaf(leaf, { focus: true });
		}
	}
}
