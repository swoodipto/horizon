import { addDays, dayDifference, parseDate } from '../planning/dates';
import type { DateKey } from '../planning/types';
import type { Contributor, EntryIdentity, GoalSnapshot } from './types';

const HOUR = 3_600_000;
const VERSION = 1;

export interface Observation {
	at: number;
	date: DateKey;
	scope: number;
	started: number;
	completed: number;
	progress: number;
	/** Break the incoming path; there was no continuous observation interval. */
	gap?: boolean;
}

export interface Completion {
	at: number;
	date: DateKey;
	/** Inclusive seven-civil-day bucket, anchored at the goal's first observation. */
	bucket: DateKey;
	contributorId: number;
}

export interface HistoryContributor extends Contributor {
	id: number;
	present: boolean;
	ambiguous: boolean;
	/** Replaced/edited inline identities cannot be resurrected as transition baselines. */
	retired?: true;
}

export interface GoalHistory {
	id: number;
	identity: EntryIdentity;
	firstObserved: number;
	lastObserved: number;
	active: boolean;
	ambiguous: boolean;
	retired?: true;
	points: Observation[];
	contributors: HistoryContributor[];
	completions: Completion[];
}

export interface InsightsHistory {
	version: 1;
	goals: GoalHistory[];
	nextId: number;
	lastObserved?: number;
}

export function emptyHistory(): InsightsHistory {
	return { version: VERSION, goals: [], nextId: 1 };
}

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function id(value: unknown): value is number {
	return count(value) && value > 0 && value < Number.MAX_SAFE_INTEGER - 1;
}

function dateAt(at: unknown): DateKey | undefined {
	if (typeof at !== 'number' || !Number.isSafeInteger(at)) return undefined;
	const date = new Date(at);
	return parseDate(`${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
}

function identity(value: unknown): EntryIdentity | undefined {
	if (!object(value) || typeof value.path !== 'string' || !value.path || /[\r\n]/.test(value.path)) return undefined;
	if (value.line === undefined) return { path: value.path };
	if (!count(value.line) || typeof value.sourceLine !== 'string' || /[\r\n]/.test(value.sourceLine)) return undefined;
	return { path: value.path, line: value.line, sourceLine: value.sourceLine };
}

function signature(value: EntryIdentity): string {
	return JSON.stringify([value.path, value.line === undefined ? null : value.sourceLine]);
}

function exact(a: EntryIdentity, b: EntryIdentity): boolean {
	return signature(a) === signature(b) && a.line === b.line;
}

function observation(value: unknown): Observation | undefined {
	if (!object(value) || !dateAt(value.at) || typeof value.date !== 'string' || !parseDate(value.date)) return undefined;
	if (!count(value.scope) || !count(value.started) || !count(value.completed) || value.started > value.scope - value.completed) return undefined;
	if (typeof value.progress !== 'number' || !Number.isFinite(value.progress) || value.progress < 0 || value.progress > 100) return undefined;
	if (value.gap !== undefined && typeof value.gap !== 'boolean') return undefined;
	return { at: value.at as number, date: value.date, scope: value.scope, started: value.started,
		completed: value.completed, progress: value.progress, ...(value.gap ? { gap: true } : {}) };
}

function contributor(value: unknown): Contributor | undefined {
	if (!object(value)) return undefined;
	const key = identity(value.identity);
	if (!key || typeof value.state !== 'string' || !['unstarted', 'started', 'completed'].includes(value.state)) return undefined;
	return { identity: key, state: value.state as Contributor['state'] };
}

function bucket(first: DateKey, date: DateKey): DateKey {
	return addDays(first, Math.max(0, Math.floor(dayDifference(first, date) / 7)) * 7);
}

/** Malformed goal records are discarded, never repaired into a transition baseline. */
function normalizeGoal(value: unknown): GoalHistory | undefined {
	if (!object(value) || !id(value.id) || typeof value.active !== 'boolean' || typeof value.ambiguous !== 'boolean') return undefined;
	const key = identity(value.identity);
	if (!key || !dateAt(value.firstObserved) || !dateAt(value.lastObserved)) return undefined;
	if (!Array.isArray(value.points) || !Array.isArray(value.contributors) || !Array.isArray(value.completions)) return undefined;
	const points: Observation[] = [];
	for (const raw of value.points) {
		const point = observation(raw);
		if (!point || point.at < (points[points.length - 1]?.at ?? point.at)) return undefined;
		points.push(point);
	}
	const first = points[0];
	const last = points[points.length - 1];
	if (!first || !last || first.at !== value.firstObserved || last.at > (value.lastObserved as number)) return undefined;
	const contributors: HistoryContributor[] = [];
	const ids = new Set<number>([value.id]);
	for (const raw of value.contributors) {
		const child = contributor(raw);
		if (!child || !object(raw) || !id(raw.id) || ids.has(raw.id) || typeof raw.present !== 'boolean' || typeof raw.ambiguous !== 'boolean') return undefined;
		ids.add(raw.id);
		if (raw.retired !== undefined && raw.retired !== true || raw.retired && raw.present) return undefined;
		contributors.push({ ...child, id: raw.id, present: raw.present, ambiguous: raw.ambiguous, ...(raw.retired ? { retired: true } : {}) });
	}
	const present = contributors.filter(child => child.present);
	if (value.active && (present.length !== last.scope || present.filter(child => child.state === 'started').length !== last.started ||
		present.filter(child => child.state === 'completed').length !== last.completed)) return undefined;
	if (!value.active && present.length) return undefined;
	const completions: Completion[] = [];
	const seen = new Set<string>();
	for (const raw of value.completions) {
		if (!object(raw) || !dateAt(raw.at) || typeof raw.date !== 'string' || !parseDate(raw.date) ||
			!id(raw.contributorId) || !contributors.some(child => child.id === raw.contributorId)) return undefined;
		const at = raw.at as number;
		if (at < first.at || at > (value.lastObserved as number) || at < (completions[completions.length - 1]?.at ?? at)) return undefined;
		const start = bucket(first.date, raw.date);
		if (raw.bucket !== start) return undefined;
		const unique = `${raw.contributorId}:${start}`;
		if (seen.has(unique)) continue;
		seen.add(unique);
		completions.push({ at, date: raw.date, bucket: start, contributorId: raw.contributorId });
	}
	if (value.retired !== undefined && value.retired !== true || value.retired && value.active) return undefined;
	return { id: value.id, identity: key, firstObserved: first.at, lastObserved: value.lastObserved as number,
		active: value.active, ambiguous: value.ambiguous, ...(value.retired ? { retired: true } : {}), points, contributors, completions };
}

/** Returns detached JSON-safe data; unknown versions fail closed without migration guesses. */
export function normalizeHistory(value: unknown): InsightsHistory {
	const result = emptyHistory();
	if (!object(value) || value.version !== VERSION || !Array.isArray(value.goals)) return result;
	const ids = new Set<number>();
	for (const raw of value.goals) {
		const goal = normalizeGoal(raw);
		if (!goal) continue;
		const keys = [goal.id, ...goal.contributors.map(child => child.id)];
		if (keys.some(key => ids.has(key))) continue;
		for (const key of keys) { ids.add(key); result.nextId = Math.max(result.nextId, key + 1); }
		result.goals.push(goal);
	}
	const latest = result.goals.reduce((at, goal) => Math.max(at, goal.lastObserved), -Infinity);
	if (dateAt(value.lastObserved) && (value.lastObserved as number) >= latest) result.lastObserved = value.lastObserved as number;
	else if (Number.isFinite(latest)) result.lastObserved = latest;
	return result;
}

type Identified = { identity: EntryIdentity; ambiguous: boolean; retired?: true };

function groups<T extends { identity: EntryIdentity }>(values: readonly T[]): Map<string, T[]> {
	const result = new Map<string, T[]>();
	for (const value of values) {
		const key = signature(value.identity);
		const group = result.get(key) ?? [];
		group.push(value);
		result.set(key, group);
	}
	return result;
}

function baselines<T extends Identified>(values: readonly T[], active: (value: T) => boolean): Map<string, T[]> {
	const result = groups(values.filter(value => !value.retired));
	for (const [key, group] of result) {
		const current = group.filter(active);
		if (current.length) result.set(key, current);
	}
	return result;
}

/** A unique identical source line can move. Introducing duplicates cannot inherit it. */
function match<T extends Identified>(previous: Map<string, T[]>, incoming: Map<string, { identity: EntryIdentity }[]>, key: EntryIdentity, ambiguous: boolean): T | undefined {
	const old = previous.get(signature(key)) ?? [];
	const current = incoming.get(signature(key)) ?? [];
	if (old.length === 1 && current.length === 1 && !ambiguous && !old[0]?.ambiguous) return old[0];
	// Previously ambiguous entries may retain their own stationary baseline, not another line's.
	if (ambiguous) {
		const stationary = old.filter(item => item.ambiguous && exact(item.identity, key));
		if (stationary.length === 1) return stationary[0];
	}
	return undefined;
}

/** Count physical inline lines across the full snapshot, not just one parent's children. */
function ambiguousLines(keys: readonly EntryIdentity[]): Set<string> {
	const locations = new Map<string, Set<number>>();
	for (const key of keys) {
		if (key.line === undefined) continue;
		const lines = locations.get(signature(key)) ?? new Set<number>();
		lines.add(key.line);
		locations.set(signature(key), lines);
	}
	return new Set([...locations].filter(([, lines]) => lines.size > 1).map(([key]) => key));
}

function replaced(key: EntryIdentity, keys: readonly EntryIdentity[], ambiguous: Set<string>): boolean {
	return key.line !== undefined && (ambiguous.has(signature(key)) ||
		keys.some(current => current.path === key.path && current.line === key.line && !exact(current, key)));
}

function newGoal(history: InsightsHistory, key: EntryIdentity, now: number, ambiguous: boolean): GoalHistory {
	const goal: GoalHistory = { id: history.nextId++, identity: key, firstObserved: now, lastObserved: now,
		active: true, ambiguous, points: [], contributors: [], completions: [] };
	history.goals.push(goal);
	return goal;
}

function observeContributors(history: InsightsHistory, goal: GoalHistory, children: Contributor[], point: Observation, continuous: boolean, ambiguousKeys: Set<string>): boolean {
	const previous = baselines(goal.contributors, child => child.present);
	const incoming = groups(children);
	const childKeys = children.map(child => child.identity);
	const present = new Set<HistoryContributor>();
	let changed = false;
	for (const child of children) {
		const ambiguous = ambiguousKeys.has(signature(child.identity)) || (incoming.get(signature(child.identity))?.length ?? 0) > 1;
		const old = match(previous, incoming, child.identity, ambiguous);
		const member = old ?? { ...child, id: history.nextId++, present: false, ambiguous };
		const completes = continuous && !ambiguous && old?.present && old.state !== 'completed' && child.state === 'completed';
		if (completes) {
			const start = bucket(goal.points[0]?.date ?? point.date, point.date);
			if (!goal.completions.some(event => event.contributorId === member.id && event.bucket === start)) {
				goal.completions.push({ at: point.at, date: point.date, bucket: start, contributorId: member.id });
			}
		}
		if (!old || !old.present || !exact(old.identity, child.identity) || old.state !== child.state) changed = true;
		if (!old) goal.contributors.push(member);
		member.identity = child.identity;
		member.state = child.state;
		member.present = true;
		member.ambiguous = ambiguous;
		present.add(member);
	}
	for (const child of goal.contributors) {
		if (!present.has(child)) {
			if (child.present) { child.present = false; changed = true; }
			if (!child.retired && (child.ambiguous || replaced(child.identity, childKeys, ambiguousKeys))) {
				child.retired = true;
				changed = true;
			}
		}
	}
	return changed;
}

/**
 * Observe the full goal set, including zero-progress goals. The caller supplies continuity
 * (false on reload/sleep); no missing hourly samples or completions are backfilled.
 * False means no changed sample/checkpoint: lastObserved heartbeats still advance in memory.
 */
export function observeGoals(history: InsightsHistory, snapshots: readonly GoalSnapshot[], now: number, continuous: boolean): boolean {
	const date = dateAt(now);
	const requiredIds = snapshots.reduce((total, snapshot) => total + 1 + snapshot.contributors.length, 0);
	if (!date || now < (history.lastObserved ?? now) || history.nextId >= Number.MAX_SAFE_INTEGER - requiredIds - 1) return false;
	const candidates = snapshots.flatMap(snapshot => {
		const key = identity(snapshot.identity);
		const point = observation({ ...snapshot, at: now, date });
		const children = snapshot.contributors.map(contributor);
		if (!key || !point || children.some(child => !child)) return [];
		const valid = children as Contributor[];
		if (new Set(valid.map(child => JSON.stringify(child.identity))).size !== valid.length) return [];
		if (valid.length !== point.scope || valid.filter(child => child.state === 'started').length !== point.started ||
			valid.filter(child => child.state === 'completed').length !== point.completed) return [];
		return [{ identity: key, point, children: valid }];
	});
	const exactGoals = new Map<string, number>();
	for (const snapshot of candidates) {
		const key = JSON.stringify(snapshot.identity);
		exactGoals.set(key, (exactGoals.get(key) ?? 0) + 1);
	}
	// Conflicting representations of one physical goal cannot choose or borrow a baseline.
	const clean = candidates.filter(snapshot => exactGoals.get(JSON.stringify(snapshot.identity)) === 1);
	const previous = baselines(history.goals, goal => goal.active);
	const incoming = groups(clean);
	const keys = candidates.flatMap(snapshot => [snapshot.identity, ...snapshot.children.map(child => child.identity)]);
	const ambiguousKeys = ambiguousLines(keys);
	for (const snapshot of candidates) {
		if ((exactGoals.get(JSON.stringify(snapshot.identity)) ?? 0) > 1) ambiguousKeys.add(signature(snapshot.identity));
	}
	const observed = new Set<GoalHistory>();
	let changed = false;
	for (const snapshot of clean) {
		const ambiguous = ambiguousKeys.has(signature(snapshot.identity)) || (incoming.get(signature(snapshot.identity))?.length ?? 0) > 1;
		const old = match(previous, incoming, snapshot.identity, ambiguous);
		const goal = old ?? newGoal(history, snapshot.identity, now, ambiguous);
		const last = goal.points[goal.points.length - 1];
		const gap = !!last && (!continuous || !goal.active);
		const point = { ...snapshot.point, ...(gap ? { gap: true } : {}) };
		const membership = observeContributors(history, goal, snapshot.children, point, continuous && goal.active && !ambiguous && !gap, ambiguousKeys);
		const metrics = !last || last.scope !== point.scope || last.started !== point.started ||
			last.completed !== point.completed || last.progress !== point.progress;
		if (!old || gap || membership || metrics || last?.date !== point.date || !exact(goal.identity, snapshot.identity) || now - (last?.at ?? now) >= HOUR) {
			goal.points.push(point);
			changed = true;
		}
		goal.identity = snapshot.identity;
		goal.active = true;
		goal.ambiguous = ambiguous;
		goal.lastObserved = now;
		observed.add(goal);
	}
	for (const goal of history.goals) {
		if (!observed.has(goal) && !goal.retired && (goal.ambiguous || replaced(goal.identity, keys, ambiguousKeys))) {
			goal.retired = true;
			changed = true;
		}
		if (goal.active && !observed.has(goal)) {
			goal.active = false;
			for (const child of goal.contributors) child.present = false;
			changed = true;
		}
	}
	history.lastObserved = now;
	return changed;
}

export function historyForGoal(history: InsightsHistory, key: EntryIdentity): GoalHistory | undefined {
	const valid = identity(key);
	if (!valid) return undefined;
	const related = history.goals.filter(goal => !goal.retired && signature(goal.identity) === signature(valid));
	const active = related.filter(goal => goal.active);
	const candidates = active.length ? active : related;
	const same = candidates.filter(goal => exact(goal.identity, valid));
	return same.length === 1 ? same[0] : candidates.length === 1 && !candidates[0]?.ambiguous ? candidates[0] : undefined;
}

/** Update goal and child identities together, including archived bucket-dedup identities. */
export function renameHistory(history: InsightsHistory, oldPath: string, newPath: string): void {
	if (oldPath === newPath || !identity({ path: oldPath }) || !identity({ path: newPath })) return;
	for (const goal of history.goals) {
		for (const key of [goal.identity, ...goal.contributors.map(child => child.identity)]) {
			if (key.path === oldPath) key.path = newPath;
			else if (key.path.startsWith(`${oldPath}/`)) key.path = `${newPath}${key.path.slice(oldPath.length)}`;
		}
	}
}
