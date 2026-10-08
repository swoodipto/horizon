import { Notice, type Plugin } from 'obsidian';
import { today } from '../planning/dates';
import type { PluginDataStore } from '../plugin-data';
import { historyForGoal, observeGoals, renameHistory, type GoalHistory } from './history';
import type { GoalSnapshot, PaceSnapshot } from './types';

const HOUR = 3_600_000;

/** Shares the progress sync's evaluated snapshots; never rescans the vault itself. */
export class InsightsService {
	goals: readonly GoalSnapshot[] = [];
	projects: readonly PaceSnapshot[] = [];
	ready = false;
	private listeners = new Set<() => void>();
	private continuous = false;
	private lastTick = Date.now();
	private lastObservation = 0;
	private date = today();
	private saveTimer: number | undefined;
	private disposed = false;
	private dirty = false;
	private saveFailed = false;

	constructor(private data: PluginDataStore) {}

	get observedAt(): number { return this.lastObservation; }

	start(plugin: Plugin, refresh: () => void): void {
		plugin.registerEvent(plugin.app.vault.on('rename', (file, oldPath) => {
			renameHistory(this.data.history, oldPath, file.path);
			this.scheduleSave();
		}));
		plugin.registerDomEvent(document, 'visibilitychange', () => {
			this.continuous = false;
			if (!document.hidden) refresh();
		});
		const timer = window.setInterval(() => {
			const now = Date.now();
			const gap = now - this.lastTick > 90_000 || now < this.lastTick;
			this.lastTick = now;
			if (document.hidden) { this.continuous = false; return; }
			if (gap) this.continuous = false;
			if (gap || this.date !== today() || now - this.lastObservation >= HOUR) refresh();
			if (this.saveFailed) this.scheduleSave();
		}, 60_000);
		plugin.registerInterval(timer);
		plugin.register(() => {
			this.disposed = true;
			window.clearTimeout(this.saveTimer);
			this.listeners.clear();
			if (this.dirty) void this.persist();
		});
	}

	accept(goals: GoalSnapshot[], projects: PaceSnapshot[] = []): void {
		if (this.disposed) return;
		const now = Date.now();
		const continuous = this.continuous && !document.hidden && now - this.lastTick <= 90_000;
		this.goals = goals;
		this.projects = projects;
		this.ready = true;
		if (observeGoals(this.data.history, goals, now, continuous)) this.scheduleSave();
		this.lastObservation = now;
		this.lastTick = now;
		this.date = today();
		this.continuous = !document.hidden;
		for (const listener of this.listeners) listener();
	}

	history(goal: Pick<GoalSnapshot, 'identity'>): GoalHistory | undefined { return historyForGoal(this.data.history, goal.identity); }

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private scheduleSave(): void {
		this.dirty = true;
		window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => { void this.persist(); }, 500);
	}

	private async persist(): Promise<void> {
		this.dirty = false;
		try { await this.data.save(); this.saveFailed = false; }
		catch (error: unknown) {
			this.dirty = true;
			if (!this.saveFailed && !this.disposed) new Notice('Could not save insights history; retrying automatically.');
			this.saveFailed = true;
			console.error('horizon: could not save insights history', error);
		}
	}
}
