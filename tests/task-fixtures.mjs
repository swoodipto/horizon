/** Synthetic native list cache, not a Markdown parser. */
export function taskCache(completed, total, { start = 1, parent = -1, col = 0 } = {}) {
	return Array.from({ length: total }, (_, index) => ({
		parent, task: index < completed ? 'x' : ' ',
		position: { start: { line: start + index, col, offset: 0 }, end: { line: start + index, col: col + 10, offset: 10 } },
	}));
}
