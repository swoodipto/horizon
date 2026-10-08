import { debounce, parseFrontMatterTags, type App, type Plugin, type TFile } from 'obsidian';
import { goalSnapshots, projectPaceSnapshots } from '../insights/model';
import type { GoalSnapshot, PaceSnapshot } from '../insights/types';
import { DATE_PROPERTIES } from '../planning/dates';
import { projectEntryStatus } from './project-filter';
import { projectStatusForTags } from './project-status';
import { projectProgress } from './goal-progress';
import { projectTaskProgress } from './project-task-progress';
import { findTaggedEntries, matchesTag } from './tagged-notes';
import { taggedMetadataReader } from './tagged-metadata';

type ProgressApp = Pick<App, 'vault' | 'metadataCache' | 'fileManager'>;

function relevantFingerprint(app: ProgressApp, file: TFile): string {
	const cache = app.metadataCache.getFileCache(file);
	return JSON.stringify([
		cache?.frontmatter?.tags, cache?.frontmatter?.parent, cache?.frontmatter?.dependent,
		cache?.frontmatter?.[DATE_PROPERTIES.start], cache?.frontmatter?.[DATE_PROPERTIES.deadline],
		(cache?.tags ?? []).map(item => [item.tag, item.position.start.line]),
		(cache?.listItems ?? []).map(item => [item.position.start.line, item.position.start.col, item.parent, item.task]),
	]);
}

/** Persist task-derived project and rolled-up goal progress, independent of open views. */
export class GoalProgressSync {
	private relevantPaths = new Set<string>();
	private ownWrites = new Map<string, { value: number; fingerprint: string }>();
	private revision = 0;
	private pending = false;
	private running = false;
	private disposed = false;

	constructor(private app: ProgressApp, private publish?: (goals: GoalSnapshot[], projects: PaceSnapshot[]) => void) {}

	refresh(): void { this.request(); }

	start(plugin: Plugin): void {
		const refresh = debounce(() => this.request(), 250, true);
		// Invalidate in-flight reads immediately, even while the next refresh is debounced.
		const changed = () => { this.revision++; refresh(); };
		plugin.register(() => { refresh.cancel(); this.disposed = true; this.revision++; });
		plugin.registerEvent(this.app.metadataCache.on('changed', file => {
			const own = this.ownWrites.get(file.path);
			if (own) {
				this.ownWrites.delete(file.path);
				const saved: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.progress;
				if (saved === own.value && relevantFingerprint(this.app, file) === own.fingerprint) return;
			}
			if (this.relevantPaths.has(file.path) || this.hasCategory(file)) changed();
		}));
		plugin.registerEvent(this.app.metadataCache.on('resolved', changed));
		plugin.registerEvent(this.app.vault.on('delete', changed));
		plugin.registerEvent(this.app.vault.on('rename', changed));
		plugin.app.workspace.onLayoutReady(() => refresh());
	}

	private hasCategory(file: TFile): boolean {
		const cache = this.app.metadataCache.getFileCache(file);
		const tags = cache?.frontmatter ? parseFrontMatterTags(cache.frontmatter) ?? [] : [];
		return matchesTag(tags, '#goal') || matchesTag(tags, '#project') ||
			(cache?.tags ?? []).some(item => matchesTag([item.tag], '#goal') || matchesTag([item.tag], '#project'));
	}

	private request(): void {
		if (this.disposed) return;
		this.revision++;
		this.pending = true;
		if (!this.running) void this.drain();
	}

	private async drain(): Promise<void> {
		this.running = true;
		try {
			while (this.pending && !this.disposed) {
				this.pending = false;
				try { await this.reconcile(); }
				catch (error: unknown) { console.error('horizon: could not update goal progress', error); }
			}
		} finally {
			this.running = false;
		}
	}

	async reconcile(): Promise<void> {
		const revision = this.revision;
		const files = this.app.vault.getMarkdownFiles();
		const metadata = taggedMetadataReader(this.app);
		const read = (file: TFile) => this.app.vault.cachedRead(file);
		const goals = await findTaggedEntries(files, metadata, read, '#goal', true);
		if (this.disposed || revision !== this.revision) return;
		const projects = await findTaggedEntries(files, metadata, read, '#project');
		if (this.disposed || revision !== this.revision) return;
		this.relevantPaths = new Set([...goals, ...projects].map(entry => entry.file.path));
		const snapshots = goalSnapshots(goals, projects, entry =>
			projectEntryStatus(entry, metadata(entry.file) ?? { noteTags: [], lineTags: [] }).tag,
			file => this.app.metadataCache.getFileCache(file)?.frontmatter,
			file => this.app.metadataCache.getFileCache(file)?.listItems);
		this.publish?.(snapshots, projectPaceSnapshots(snapshots, projects, entry =>
			projectEntryStatus(entry, metadata(entry.file) ?? { noteTags: [], lineTags: [] }).tag,
			file => this.app.metadataCache.getFileCache(file)?.frontmatter,
			file => this.app.metadataCache.getFileCache(file)?.listItems));
		for (const project of projects) {
			if (this.disposed || revision !== this.revision) return;
			if (project.line !== undefined) continue;
			const cache = this.app.metadataCache.getFileCache(project.file);
			if (!cache) continue;
			const tags = parseFrontMatterTags(cache?.frontmatter ?? {}) ?? [];
			// A dual-tagged note is a goal entry; its derived goal value owns the property.
			if (matchesTag(tags, '#goal')) continue;
			const measured = projectTaskProgress(project, cache.listItems);
			const desired = Math.round(projectProgress(projectStatusForTags(tags).tag, measured));
			if (cache.frontmatter?.progress === desired) continue;
			const fingerprint = relevantFingerprint(this.app, project.file);
			let written = false;
			this.ownWrites.set(project.file.path, {
				value: desired, fingerprint,
			});
			try {
				await this.app.fileManager.processFrontMatter(project.file, (current: Record<string, unknown>) => {
					if (this.disposed || revision !== this.revision ||
						relevantFingerprint(this.app, project.file) !== fingerprint) return;
					const currentTags = parseFrontMatterTags(current) ?? [];
					if (!matchesTag(currentTags, '#project') || matchesTag(currentTags, '#goal') ||
						Math.round(projectProgress(projectStatusForTags(currentTags).tag, measured)) !== desired ||
						current.progress === desired) return;
					current.progress = desired;
					written = true;
				});
			} catch (error: unknown) {
				console.error('horizon: could not save project progress', error);
				this.ownWrites.delete(project.file.path);
			}
			if (!written) this.ownWrites.delete(project.file.path);
		}
		const progress = new Map(snapshots.map(snapshot => [snapshot.entry, snapshot.progress]));
		for (const goal of goals) {
			if (this.disposed || revision !== this.revision) return;
			if (goal.line !== undefined) continue;
			const desired = Math.round(progress.get(goal) ?? 0);
			const cache = this.app.metadataCache.getFileCache(goal.file);
			if (cache?.frontmatter?.progress === desired) continue;
			let written = false;
			this.ownWrites.set(goal.file.path, {
				value: desired, fingerprint: relevantFingerprint(this.app, goal.file),
			});
			try {
				await this.app.fileManager.processFrontMatter(goal.file, (current: Record<string, unknown>) => {
					if (this.disposed || revision !== this.revision) return;
					if (!matchesTag(parseFrontMatterTags(current) ?? [], '#goal') || current.progress === desired) return;
					current.progress = desired;
					written = true;
				});
			} catch (error: unknown) {
				console.error('horizon: could not save goal progress', error);
				this.ownWrites.delete(goal.file.path);
			}
			if (!written) this.ownWrites.delete(goal.file.path);
		}
	}
}
