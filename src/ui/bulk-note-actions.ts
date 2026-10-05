/** Sequential writes keep same-note inline edits safe and report partial failures honestly. */
export async function applyToItems<T>(items: readonly T[], apply: (item: T) => Promise<void>): Promise<void> {
	let completed = 0;
	const failures: string[] = [];
	for (const item of items) {
		try { await apply(item); completed++; }
		catch (error: unknown) { failures.push(error instanceof Error ? error.message : 'Could not update item.'); }
	}
	if (failures.length && items.length === 1) throw new Error(failures[0]);
	if (failures.length) throw new Error(`${completed} of ${items.length} updated. ${failures.length} failed: ${[...new Set(failures)].join(' ')}`);
}
