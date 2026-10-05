import { stringifyYaml } from 'obsidian';
import type { App, CachedMetadata, TFile, TagCache } from 'obsidian';
import { projectStatusForTags } from '../ui/project-status';
import { matchesTag } from '../ui/tagged-notes';
import { DATE_PROPERTIES, parseDate } from './dates';
import type { PlanningProject, ProjectDates } from './types';

type Properties = Record<string, unknown>;
const STALE_PLAN = 'The project plan changed. Reopen it and try again.';
const STALE_LINE = 'The project line changed. Reopen it and try again.';

function propertyTags(value: unknown): string[] {
	const values = typeof value === 'string' ? value.split(/[\s,]+/) : Array.isArray(value) ? value : [];
	return values.filter((tag): tag is string => typeof tag === 'string').map(tag => `#${tag.replace(/^#/, '')}`);
}

function isProject(tags: readonly string[]): boolean {
	return matchesTag(tags, '#project') || matchesTag(tags, '#projects');
}

function fingerprint(properties: Properties): string {
	return JSON.stringify([properties[DATE_PROPERTIES.start], properties.deadline, properties.dependent]);
}

function validateDates(dates: ProjectDates): ProjectDates {
	for (const name of ['start', 'deadline'] as const) {
		if (dates[name] !== undefined && !parseDate(dates[name])) throw new Error(`Enter a valid ${name} in YYYY-MM-DD format.`);
	}
	if (dates.start && dates.deadline && dates.deadline < dates.start) throw new Error('The deadline cannot be before the start date.');
	return { ...(dates.start ? { start: dates.start } : {}), ...(dates.deadline ? { deadline: dates.deadline } : {}) };
}

function writeDates(properties: Properties, dates: ProjectDates): void {
	for (const name of ['start', 'deadline'] as const) {
		if (dates[name]) properties[DATE_PROPERTIES[name]] = dates[name];
		else delete properties[DATE_PROPERTIES[name]];
	}
}

function safeFilename(title: string): string {
	const printable = [...title].map(character => character.charCodeAt(0) < 32 ? '-' : character).join('');
	return printable.replace(/[\\/:*?"<>|#[\]]/g, '-').replace(/^[. ]+|[. ]+$/g, '').slice(0, 180) || 'Project';
}

function wikiLink(path: string, title?: string): string {
	const target = path.replace(/\.md$/i, '');
	return `[[${target}${title ? `|${title.replace(/[[\]|\r\n]/g, '')}` : ''}]]`;
}

function dependencyLinks(value: unknown): string[] {
	const values: unknown[] = Array.isArray(value) ? (value as unknown[]).flat(2) : [value];
	const paths: string[] = [];
	for (const item of values) {
		if (typeof item !== 'string' || !item.trim()) continue;
		const links = [...item.matchAll(/\[\[([^\]]+)\]\]/g)].map(match => match[1] ?? '');
		for (const link of links.length ? links : [item]) {
			const path = link.split('|')[0]?.split('#')[0]?.trim();
			if (path) paths.push(path);
		}
	}
	return [...new Set(paths)];
}

function inlineTitle(line: string, tags: readonly TagCache[]): string {
	let text = line;
	for (const tag of [...tags].sort((a, b) => b.position.start.col - a.position.start.col)) {
		text = text.slice(0, tag.position.start.col) + text.slice(tag.position.end.col);
	}
	return text.trim().replace(/^(?:>\s*)+/, '').replace(/^(?:[-+*]|\d+[.)])\s+/, '')
		.replace(/^\[[ xX]\]\s*/, '').replace(/^#{1,6}\s+/, '').replace(/[\t ]{2,}/g, ' ').trim() || 'Project';
}

/** Only a uniquely identifiable, unchanged source line may become a note link. */
function replaceInline(content: string, project: PlanningProject, link: string): string {
	const target = project.inline;
	if (!target || !Number.isInteger(target.line) || target.line < 0) throw new Error(STALE_LINE);
	const parts = content.split(/(\r?\n)/);
	const indices: number[] = [];
	for (let index = 0; index < parts.length; index += 2) if (parts[index] === target.sourceLine) indices.push(index);
	if (indices.length !== 1) throw new Error(STALE_LINE);
	const index = indices[0]!;
	const line = parts[index]!;
	// Tags inside code spans or existing links are literal copy, not project markers.
	const visible = line.replace(/(`+).*?\1|\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)/g, item => ' '.repeat(item.length));
	const tags = [...visible.matchAll(/(^|[^\p{L}\p{N}_/#-])#projects?(?:\/[\p{L}\p{N}_/-]+)*(?![\p{L}\p{N}_/-])/giu)];
	if (!tags.length) throw new Error(STALE_LINE);
	let updated = line;
	for (let position = tags.length - 1; position >= 0; position--) {
		const tag = tags[position]!;
		const start = tag.index + (tag[1]?.length ?? 0);
		const end = tag.index + tag[0].length;
		updated = updated.slice(0, start) + (position === 0 ? link : '') + updated.slice(end);
	}
	parts[index] = updated;
	return parts.join('');
}

/** Local note properties are the single source of truth for every planning view. */
export class PlanningStore {
	private snapshots = new WeakMap<PlanningProject, string>();

	constructor(private app: App) {}

	async load(): Promise<PlanningProject[]> {
		const groups = await Promise.all(this.app.vault.getMarkdownFiles().map(async file => {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) return [];
			const projects: PlanningProject[] = [];
			if (isProject(propertyTags(cache.frontmatter?.tags))) projects.push(this.note(file, cache.frontmatter ?? {}));
			const inlineTags = (cache.tags ?? []).filter(tag => isProject([tag.tag]));
			if (!inlineTags.length) return projects;
			const lines = (await this.app.vault.cachedRead(file)).split(/\r?\n/);
			const lineNumbers = new Set(inlineTags.map(tag => tag.position.start.line));
			for (const line of lineNumbers) {
				const sourceLine = lines[line];
				if (sourceLine === undefined) continue;
				const tags = inlineTags.filter(tag => tag.position.start.line === line &&
					sourceLine.slice(tag.position.start.col, tag.position.end.col) === tag.tag);
				if (!tags.length) continue; // Metadata may lag a just-promoted source line.
				projects.push({ id: `${file.path}:${line}`, path: file.path, title: inlineTitle(sourceLine, tags),
					status: projectStatusForTags((cache.tags ?? []).filter(tag => tag.position.start.line === line).map(tag => tag.tag)).tag,
					dependencies: [], inline: { line, sourceLine } });
			}
			return projects;
		}));
		return groups.flat().sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id));
	}

	async saveDates(project: PlanningProject, dates: ProjectDates): Promise<PlanningProject> {
		return this.save(project, validateDates(dates));
	}

	async savePlan(project: PlanningProject, dates: ProjectDates, dependencyPaths: readonly string[]): Promise<PlanningProject> {
		return this.save(project, validateDates(dates), this.links(dependencyPaths));
	}

	async create(title: string, dates: ProjectDates, dependencyPaths: readonly string[] = []): Promise<PlanningProject> {
		const text = title.trim();
		if (!text) throw new Error('Enter a project title.');
		const properties: Properties = { tags: ['project'] };
		writeDates(properties, validateDates(dates));
		const dependencies = this.links(dependencyPaths);
		if (dependencies.length) properties.dependent = dependencies;
		const { file } = await this.createNote(text, '', properties);
		return this.note(file, properties);
	}

	private note(file: TFile, properties: Properties): PlanningProject {
		const invalidDates = (['start', 'deadline'] as const).filter(name =>
			properties[DATE_PROPERTIES[name]] != null && properties[DATE_PROPERTIES[name]] !== '' && !parseDate(properties[DATE_PROPERTIES[name]]));
		const dependencies = dependencyLinks(properties.dependent).map(linkpath => {
			const destination = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
			const title: unknown = destination ? this.app.metadataCache.getFileCache(destination)?.frontmatter?.title : undefined;
			return { title: typeof title === 'string' ? title : destination?.basename ?? linkpath.split('/').pop()?.replace(/\.md$/i, '') ?? linkpath,
				linkpath, ...(destination ? { path: destination.path } : {}) };
		});
		const project: PlanningProject = { id: file.path, path: file.path,
			title: typeof properties.title === 'string' && properties.title.trim() ? properties.title : file.basename,
			status: projectStatusForTags(propertyTags(properties.tags)).tag,
			start: parseDate(properties[DATE_PROPERTIES.start]), deadline: parseDate(properties.deadline), dependencies,
			...(typeof properties.color === 'string' ? { color: properties.color } : {}),
			...(invalidDates.length ? { invalidDates } : {}) };
		this.snapshots.set(project, fingerprint(properties));
		return project;
	}

	private links(paths: readonly string[]): string[] {
		return [...new Set(paths.map(path => path.trim()).filter(Boolean))].map(path => {
			// Missing linkpaths are intentionally retained so their warnings remain actionable.
			const plain = /^\[\[([^\]]+)\]\]$/.exec(path)?.[1]?.split('|')[0] ?? path;
			if (/[[\]|\r\n]/.test(plain)) throw new Error('Use a valid note path for dependencies.');
			return wikiLink(plain);
		});
	}

	private async save(project: PlanningProject, dates: ProjectDates, dependencies?: string[]): Promise<PlanningProject> {
		if (project.inline) return this.promote(project, dates, dependencies ?? []);
		const file = this.app.vault.getFileByPath(project.path);
		if (!file) throw new Error('The project note no longer exists.');
		const expected = this.snapshots.get(project);
		if (expected === undefined) throw new Error(STALE_PLAN);
		this.guard(file, expected);
		let saved: Properties | undefined;
		await this.app.fileManager.processFrontMatter(file, (properties: Properties) => {
			if (!isProject(propertyTags(properties.tags)) || fingerprint(properties) !== expected) throw new Error(STALE_PLAN);
			writeDates(properties, dates);
			if (dependencies !== undefined) {
				if (dependencies.length) properties.dependent = dependencies;
				else delete properties.dependent;
			}
			saved = { ...properties };
		});
		if (!saved) throw new Error('Could not save the project plan.');
		return this.note(file, saved);
	}

	private guard(file: TFile, expected: string): void {
		const cache: CachedMetadata | null = this.app.metadataCache.getFileCache(file);
		if (!cache?.frontmatter || !isProject(propertyTags(cache.frontmatter.tags)) || fingerprint(cache.frontmatter) !== expected) {
			throw new Error(STALE_PLAN);
		}
	}

	private async promote(project: PlanningProject, dates: ProjectDates, dependencies: string[]): Promise<PlanningProject> {
		if (!dates.start && !dates.deadline) throw new Error('Choose at least one date to create a project note.');
		const source = this.app.vault.getFileByPath(project.path);
		if (!source) throw new Error('The source note no longer exists.');
		// Check before creating anything and again inside the atomic source update.
		replaceInline(await this.app.vault.read(source), project, '[[Project]]');
		const properties: Properties = { tags: ['project', ...(project.status === 'todo' ? [] : [project.status])], parent: wikiLink(source.path) };
		writeDates(properties, dates);
		if (dependencies.length) properties.dependent = dependencies;
		const folder = source.parent?.path ?? source.path.slice(0, Math.max(0, source.path.lastIndexOf('/')));
		const { file, content } = await this.createNote(project.title, folder === '/' ? '' : folder, properties);
		try {
			await this.app.vault.process(source, current => replaceInline(current, project, wikiLink(file.path, file.basename === project.title ? undefined : project.title)));
		} catch (cause) {
			// Never delete a promoted note that another writer changed after creation.
			if (this.app.vault.getFileByPath(file.path) === file && await this.app.vault.read(file) === content) {
				// Roll back only the untouched note this operation just created.
				await this.app.fileManager.trashFile(file);
			}
			throw cause;
		}
		return this.note(file, properties);
	}

	private async createNote(title: string, folder: string, properties: Properties): Promise<{ file: TFile; content: string }> {
		const basename = safeFilename(title);
		for (let suffix = 0; suffix < 10_000; suffix++) {
			const name = `${basename}${suffix ? ` ${suffix + 1}` : ''}`;
			const path = `${folder ? `${folder}/` : ''}${name}.md`;
			if (this.app.vault.getAbstractFileByPath(path)) continue;
			if (name !== title) properties.title = title;
			const content = `---\n${stringifyYaml(properties).trimEnd()}\n---\n`;
			try { return { file: await this.app.vault.create(path, content), content }; }
			catch (cause) { if (!this.app.vault.getAbstractFileByPath(path)) throw cause; }
		}
		throw new Error('Could not find an available project note name.');
	}
}
