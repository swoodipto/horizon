export interface ProjectStatusTarget {
	path: string;
	line?: number;
	sourceLine?: string;
}

/** Keep native anchors and closing Markdown delimiters after appended entry fields. */
export function projectLineSuffix(line: string): { core: string; suffix: string; trailing: string } {
	const trailing = line.match(/[\t ]*$/)?.[0] ?? '';
	let core = line.slice(0, line.length - trailing.length);
	const anchor = core.match(/[\t ]+\^[A-Za-z0-9-]+$/)?.[0] ?? '';
	core = core.slice(0, core.length - anchor.length);
	const delimiter = /^\s*(?:>\s*)*\|/.test(core) ? core.match(/(?<!\\)[\t ]*\|$/)?.[0] ?? ''
		: /^ {0,3}#{1,6}\s/.test(core) ? core.match(/[\t ]+#+$/)?.[0] ?? '' : '';
	return { core: core.slice(0, core.length - delimiter.length), suffix: delimiter + anchor, trailing };
}
