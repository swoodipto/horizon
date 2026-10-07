import { normalizeSettings, type HorizonSettings } from './settings';
import { normalizeHistory, type InsightsHistory } from './insights/history';

/** One writer owns preferences and history so neither can erase the other. */
export class PluginDataStore {
	settings: HorizonSettings;
	history: InsightsHistory;
	private queue: Promise<void> = Promise.resolve();

	constructor(data: unknown, private write: (data: unknown) => Promise<void>) {
		const saved = data && typeof data === 'object' ? data as Record<string, unknown> : {};
		this.settings = normalizeSettings(saved.settings ?? saved);
		this.history = normalizeHistory(saved.insights);
	}

	save(settings?: HorizonSettings): Promise<void> {
		if (settings) this.settings = { ...settings };
		// Snapshot at execution time, not when an older settings/history save was queued.
		this.queue = this.queue.catch(() => undefined).then(async () => {
			const data: unknown = JSON.parse(JSON.stringify({
				...this.settings, schemaVersion: 1, insights: this.history,
			}));
			await this.write(data);
		});
		return this.queue;
	}
}
