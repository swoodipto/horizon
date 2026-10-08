import type { ListItemCache } from 'obsidian';

/** Native cached tasks exclude code blocks and do not follow linked/embedded notes. */
export function projectTaskProgress(
	entry: { line?: number }, items: readonly ListItemCache[] | undefined,
): number {
	const list = items ?? [];
	const root = entry.line === undefined ? undefined : list.find(item => item.position.start.line === entry.line);
	if (entry.line !== undefined && !root) return 0;
	const descendants = new Set<number>();
	if (root) descendants.add(root.position.start.line);
	let total = 0;
	let completed = 0;
	for (const item of [...list].sort((a, b) => a.position.start.line - b.position.start.line)) {
		if (root) {
			if (item.position.start.line <= root.position.start.line || !descendants.has(item.parent)) continue;
			// A list beginning on line zero has root parent -0, indistinguishable from 0.
			// Siblings are not children: only an indented item can descend from that root.
			if (root.position.start.line === 0 && item.parent === 0 &&
				item.position.start.col <= root.position.start.col) continue;
			descendants.add(item.position.start.line);
		}
		if (item.task === undefined) continue;
		total++;
		// Match Obsidian's native checkbox contract, including custom non-space marks.
		if (item.task !== ' ') completed++;
	}
	return total ? completed / total * 100 : 0;
}
