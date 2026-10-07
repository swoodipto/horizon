import { addDays, dayDifference, parseDate } from '../planning/dates';
import type { DateKey } from '../planning/types';
import type { goalForecast } from './forecast';

export interface GraphPoint {
	at: number;
	date: DateKey;
	scope: number;
	started: number;
	completed: number;
	progress: number;
	/** Break the incoming curve: the preceding interval was not observed. */
	gap?: boolean;
}

interface GraphLayout {
	width: number;
	height: number;
	from: DateKey;
	to: DateKey;
	max: number;
	x: (date: DateKey) => number;
	y: (count: number) => number;
	samples: Array<{ point: GraphPoint; x: number; gap?: boolean }>;
	scopePath: string;
	startedPath: string;
	completedPath: string;
	areaPath: string;
	forecastPaths: string[];
	deadlineX?: number;
}

type Observation = { point: GraphPoint; gap: boolean };
type Position = { x: number; y: number };

function count(value: number): number {
	return Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, value)) : 0;
}

function dimension(value: number, fallback: number): number {
	return Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, value)) : fallback;
}

/** Latest timestamp wins within a civil date; ties retain the last input observation. */
function observations(points: readonly GraphPoint[]): Observation[] {
	const sorted = points.filter(point => parseDate(point.date)).map((point, index) => ({ point, index }));
	sorted.sort((a, b) => a.point.date.localeCompare(b.point.date) ||
		(Number.isFinite(a.point.at) ? a.point.at : 0) - (Number.isFinite(b.point.at) ? b.point.at : 0) || a.index - b.index);
	const dates = new Map<DateKey, Observation>();
	for (const { point } of sorted) {
		// A later same-day checkpoint must not erase an earlier observation gap.
		dates.set(point.date, { point, gap: !!point.gap || !!dates.get(point.date)?.gap });
	}
	return [...dates.values()];
}

/** Seven-civil-day buckets begin at the first real observation, not at the plan start. */
function sampleRuns(actual: readonly Observation[], currentDate: DateKey): GraphPoint[][] {
	const first = actual[0]?.point;
	if (!first) return [];
	const runs: GraphPoint[][] = [];
	let previous: GraphPoint | undefined;
	for (const { point, gap } of actual) {
		// Even absent an explicit flag, a whole unknown week cannot imply continuity.
		if (!previous || gap || dayDifference(previous.date, point.date) > 7) runs.push([]);
		runs[runs.length - 1]?.push(point);
		previous = point;
	}
	return runs.map(run => {
		const buckets = new Map<number, { first: GraphPoint; last: GraphPoint }>();
		const selected = new Set<GraphPoint>();
		for (const point of run) {
			const bucket = Math.floor(dayDifference(first.date, point.date) / 7);
			const endpoints = buckets.get(bucket);
			if (endpoints) endpoints.last = point;
			else buckets.set(bucket, { first: point, last: point });
			if (point.date === currentDate) selected.add(point);
		}
		for (const { first, last } of buckets.values()) { selected.add(first); selected.add(last); }
		return run.filter(point => selected.has(point));
	});
}

/** Both controls share a midpoint x and their endpoint y: the cubic cannot overshoot. */
function curve(positions: readonly Position[]): string {
	const first = positions[0];
	if (!first) return '';
	let path = `M ${first.x} ${first.y}`;
	let previous = first;
	for (const next of positions.slice(1)) {
		const middle = previous.x + (next.x - previous.x) / 2;
		path += ` C ${middle} ${previous.y} ${middle} ${next.y} ${next.x} ${next.y}`;
		previous = next;
	}
	return path;
}

function padded(date: DateKey, offset: number): DateKey {
	try { return addDays(date, offset); }
	catch { return date; } // At years 0001/9999, pad only toward the supported calendar.
}

/** Pure SVG geometry. No history synthesis, DOM access, or forecast recalculation. */
export function graphLayout(points: readonly GraphPoint[], forecast: ReturnType<typeof goalForecast>,
	currentDate: DateKey, width = 409, height = 170): GraphLayout {
	width = dimension(width, 409);
	height = dimension(height, 170);
	const current = parseDate(currentDate) ?? '1970-01-01';
	const actual = observations(points);
	const dates = [current, ...actual.map(({ point }) => point.date), forecast.start, forecast.deadline];
	if (forecast.kind === 'estimate') dates.push(forecast.anchor, forecast.earlier, forecast.finish, forecast.later);
	let from = current;
	let to = current;
	for (const candidate of dates) {
		const date = parseDate(candidate);
		if (date) { if (date < from) from = date; if (date > to) to = date; }
	}
	if (from === to) { from = padded(from, -1); to = padded(to, 1); }
	const days = dayDifference(from, to);
	const side = Math.min(10, width / 4);
	const top = Math.min(3, height / 4);
	const bottom = height - Math.min(10, height / 4);
	const max = actual.reduce((maximum, { point }) => Math.max(maximum, count(point.scope)), 1);
	const x = (date: DateKey): number => {
		const ratio = parseDate(date) ? Math.max(0, Math.min(1, dayDifference(from, date) / days)) : 0;
		return side + ratio * (width - 2 * side);
	};
	const y = (value: number): number => bottom - Math.min(max, count(value)) / max * (bottom - top);
	const runs = sampleRuns(actual, current);
	const samples = runs.flatMap((run, runIndex) => run.map((point, index) => ({ point, x: x(point.date),
		...((runIndex > 0 && index === 0 || point.gap) ? { gap: true } : {}) })));
	const positions = (run: readonly GraphPoint[], value: (point: GraphPoint) => number): Position[] =>
		run.map(point => ({ x: x(point.date), y: y(value(point)) }));
	const scope = (point: GraphPoint): number => count(point.scope);
	const completed = (point: GraphPoint): number => Math.min(scope(point), count(point.completed));
	const started = (point: GraphPoint): number => Math.min(scope(point), count(point.started) + count(point.completed));
	const paths = (value: (point: GraphPoint) => number): string => runs.map(run => curve(positions(run, value))).join(' ');
	const areaPath = runs.filter(run => run.length > 1).map(run => {
		const values = positions(run, completed);
		const first = values[0];
		const last = values[values.length - 1];
		return first && last ? `${curve(values)} L ${last.x} ${y(0)} L ${first.x} ${y(0)} Z` : '';
	}).join(' ');
	const forecastPaths: string[] = [];
	const latest = actual[actual.length - 1]?.point;
	if (forecast.kind === 'estimate' && latest && parseDate(forecast.anchor) && scope(latest) > completed(latest)) {
		// Forecasts end at CURRENT scope, not the maximum historic scope on the y axis.
		for (const finish of new Set([forecast.earlier, forecast.finish, forecast.later])) {
			// Same-day finishes are endpoint markers owned by the SVG renderer, not vertical curves.
			if (parseDate(finish) && finish > forecast.anchor) forecastPaths.push(
				`M ${x(forecast.anchor)} ${y(completed(latest))} L ${x(finish)} ${y(scope(latest))}`);
		}
	}
	return {
		width, height, from, to, max, x, y, samples,
		scopePath: paths(scope), startedPath: paths(started), completedPath: paths(completed),
		areaPath, forecastPaths,
		...(parseDate(forecast.deadline) ? { deadlineX: x(forecast.deadline as DateKey) } : {}),
	};
}
