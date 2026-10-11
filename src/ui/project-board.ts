import { Component, Notice, setIcon, type App } from 'obsidian';
import { projectBoard, type BoardCard, type BoardLane, type BoardPreferences, type BoardStatus, type ProjectEntry } from './project-board-model';
import { renderProjectCard } from './project-board-card';
import { applyBoardMove, prepareBoardMove, type PreparedBoardMove } from './project-board-move';
import type { NoteActionHistory } from './note-action-history';

interface Gesture { pointer: number; x: number; y: number; currentX: number; currentY: number; card: BoardCard; prepared: Promise<PreparedBoardMove>; started: boolean }

/** One controller per results view; redraws cannot leave document-level gesture listeners behind. */
export class ProjectBoard extends Component {
	private retained = new Map<string, BoardLane>();
	private cards = new Map<HTMLElement, BoardCard>();
	private gesture?: Gesture;
	private ghost?: HTMLElement;
	private target?: HTMLElement;
	private board?: HTMLElement;
	private suppressClickUntil = 0;
	private saving = false;
	private frame = 0;
	private pendingFocus?: { path: string; line?: number; lane: string };
	private scroll = { left: 0, top: 0 };
	get isInteracting(): boolean { return !!this.gesture || this.saving; }

	constructor(private app: App, private root: HTMLElement, private history: NoteActionHistory,
		private refresh: () => Promise<void>, private enabled: () => boolean, private focusEntry: (path: string, line: number | undefined, lane: string) => boolean) {
		super();
		this.registerDomEvent(root, 'pointerdown', event => this.start(event));
		this.registerDomEvent(root.ownerDocument, 'pointermove', event => this.move(event));
		this.registerDomEvent(root.ownerDocument, 'pointerup', event => { void this.finish(event); });
		this.registerDomEvent(root.ownerDocument, 'pointercancel', () => this.cancel());
		this.registerDomEvent(root, 'lostpointercapture', () => { if (this.gesture) this.cancel(); });
		this.registerDomEvent(root, 'click', event => {
			if (Date.now() < this.suppressClickUntil || (event.target as HTMLElement | null)?.closest('[data-drag-handle]')) {
				event.preventDefault(); event.stopImmediatePropagation();
			}
		}, true);
		this.registerDomEvent(root.ownerDocument, 'keydown', event => {
			if (event.key === 'Escape' && this.gesture) { event.preventDefault(); event.stopImmediatePropagation(); this.cancel(); return; }
			this.navigate(event);
		}, true);
		const win = root.ownerDocument.defaultView;
		if (win) this.registerDomEvent(win, 'blur', () => this.cancel());
		this.register(() => { this.cleanGesture(); this.retained.clear(); this.cards.clear(); });
	}

	beforeRender(): void {
		if (this.board?.isConnected) this.scroll = { left: this.board.scrollLeft, top: this.board.scrollTop };
	}

	afterRender(): void {
		const pending = this.pendingFocus; if (!pending || !this.enabled()) return;
		const focused = this.root.ownerDocument.activeElement;
		if (focused && focused !== this.root.ownerDocument.body && !this.root.contains(focused)) { this.pendingFocus = undefined; return; }
		if (this.focusEntry(pending.path, pending.line, pending.lane)) this.pendingFocus = undefined;
	}

	render(entries: ProjectEntry[], status: (entry: ProjectEntry) => BoardStatus, preferences: BoardPreferences): void {
		this.cleanGesture(); this.cards.clear();
		const model = projectBoard(entries, status, preferences, this.retained);
		const counts = new Map<BoardStatus, number>(); const seen = new Set<ProjectEntry>();
		for (const card of model.cards) if (!seen.has(card.entry)) {
			seen.add(card.entry); counts.set(card.status, (counts.get(card.status) ?? 0) + 1);
		}
		const titles = new Map<string, number>(); const laneNames = new Map<string, number>();
		for (const entry of entries) titles.set(entry.text, (titles.get(entry.text) ?? 0) + 1);
		for (const lane of model.lanes) laneNames.set(lane.name, (laneNames.get(lane.name) ?? 0) + 1);
		const board = this.root.createDiv({ cls: 'horizon-kanban', attr: { 'aria-label': 'Projects by status' } });
		this.board = board;
		board.style.setProperty('--horizon-board-columns', String(Math.max(1, model.statuses.length)));
		if (!model.statuses.length) { board.createEl('p', { cls: 'horizon-empty-state', text: 'No projects. Show empty columns in view options to see every status.' }); return; }
		const renderHeading = (parent: HTMLElement, status: typeof model.statuses[number]) => {
			const heading = parent.createDiv({ cls: 'horizon-kanban-column-title' });
			const icon = heading.createSpan({ attr: { 'aria-hidden': 'true' } }); setIcon(icon, status.icon);
			heading.createSpan({ text: status.tag.charAt(0).toUpperCase() + status.tag.slice(1) });
			heading.createSpan({ cls: 'horizon-note-count', text: String(counts.get(status.tag) ?? 0) });
		};
		if (preferences.swimlanes) {
			const headers = board.createDiv({ cls: 'horizon-kanban-headers' });
			for (const status of model.statuses) renderHeading(headers, status);
		}
		for (const lane of model.lanes) {
			const section = board.createEl('section', { cls: 'horizon-kanban-lane', attr: { 'aria-label': lane.name } });
			if (preferences.swimlanes) section.createEl('h4', { cls: 'horizon-kanban-lane-title',
				text: (laneNames.get(lane.name) ?? 0) > 1 && lane.path ? `${lane.name} · ${lane.path}` : lane.name, attr: { title: lane.path ?? lane.name } });
			const cells = section.createDiv({ cls: 'horizon-kanban-cells' });
			for (const status of model.statuses) {
				const items = model.cards.filter(card => card.lane.id === lane.id && card.status === status.tag);
				const cell = cells.createDiv({ cls: 'horizon-kanban-cell', attr: { 'data-board-status': status.tag,
					'data-board-lane': lane.id, 'aria-label': `${lane.name}, ${status.tag}, ${items.length} projects` } });
				if (!preferences.swimlanes) renderHeading(cell, status);
				for (const card of items) {
					const element = renderProjectCard(cell, card, this.app.metadataCache.getFileCache(card.entry.file)?.frontmatter, (titles.get(card.entry.text) ?? 0) > 1);
					this.cards.set(element, card);
				}
			}
		}
		board.scrollLeft = this.scroll.left; board.scrollTop = this.scroll.top;
	}

	private start(event: PointerEvent): void {
		if (!this.enabled() || this.isInteracting || event.button !== 0 || event.isPrimary === false || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		const row = target?.closest<HTMLElement>('.horizon-kanban-card');
		const card = row && this.cards.get(row); if (!card || !target) return;
		const handle = target.closest('[data-drag-handle]');
		if ((!handle && event.pointerType !== 'mouse') || (!handle && target.closest('button'))) return;
		if (handle) event.preventDefault();
		this.gesture = { pointer: event.pointerId, x: event.clientX, y: event.clientY, currentX: event.clientX, currentY: event.clientY,
			card, prepared: prepareBoardMove(this.app, card), started: false };
	}

	private move(event: PointerEvent): void {
		const gesture = this.gesture; if (!gesture || event.pointerId !== gesture.pointer) return;
		if (!this.enabled()) { this.cancel(); return; }
		gesture.currentX = event.clientX; gesture.currentY = event.clientY;
		if (!gesture.started && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 7) return;
		if (!gesture.started) {
			gesture.started = true; this.root.setPointerCapture(event.pointerId);
			this.ghost = this.root.ownerDocument.body.createDiv({ cls: 'horizon-kanban-drag-preview', text: gesture.card.entry.text, attr: { 'aria-hidden': 'true' } });
			this.autoScroll();
		}
		event.preventDefault(); this.positionGesture();
	}

	private positionGesture(): void {
		const gesture = this.gesture; if (!gesture?.started) return;
		if (this.ghost) this.ghost.style.transform = `translate(${gesture.currentX + 12}px, ${gesture.currentY + 12}px)`;
		const target = this.root.ownerDocument.elementFromPoint(gesture.currentX, gesture.currentY)?.closest<HTMLElement>('.horizon-kanban-cell');
		this.target?.removeClass('is-drop-target');
		this.target = target && this.board?.contains(target) ? target : undefined;
		this.target?.addClass('is-drop-target');
	}

	private autoScroll(): void {
		const tick = () => {
			const gesture = this.gesture; const board = this.board;
			if (!gesture?.started || !board) return;
			const rect = board.getBoundingClientRect();
			const speed = (point: number, start: number, end: number) => point < start + 42 ? -12 : point > end - 42 ? 12 : 0;
			board.scrollLeft += speed(gesture.currentX, rect.left, rect.right);
			board.scrollTop += speed(gesture.currentY, rect.top, rect.bottom);
			this.positionGesture(); this.frame = window.requestAnimationFrame(tick);
		};
		this.frame = window.requestAnimationFrame(tick);
	}

	private async finish(event: PointerEvent): Promise<void> {
		const gesture = this.gesture; if (!gesture || event.pointerId !== gesture.pointer) return;
		if (!this.enabled()) { this.cancel(); return; }
		const destination = this.target;
		if (gesture.started) this.suppressClickUntil = Date.now() + 450;
		this.cleanGesture();
		if (!gesture.started) return;
		if (!destination) { await this.refresh(); return; }
		const laneId = destination.getAttribute('data-board-lane') ?? '';
		const lane = this.retained.get(laneId) ?? { id: laneId, name: 'Projects' };
		const status = destination.getAttribute('data-board-status') as BoardStatus;
		this.saving = true; this.root.setAttribute('aria-busy', 'true');
		try {
			const result = await applyBoardMove(this.app, this.history, await gesture.prepared, lane, status);
			if (result) this.pendingFocus = { ...result, lane: lane.id };
		}
		catch (cause: unknown) { new Notice(cause instanceof Error ? cause.message : 'Could not move the project.'); }
		finally { this.saving = false; this.root.removeAttribute('aria-busy'); await this.refresh(); }
	}

	private cancel(): void {
		if (!this.gesture) return;
		this.suppressClickUntil = Date.now() + 450; this.cleanGesture(); void this.refresh();
	}
	private cleanGesture(): void {
		const pointer = this.gesture?.pointer; this.gesture = undefined;
		if (pointer !== undefined && this.root.hasPointerCapture(pointer)) this.root.releasePointerCapture(pointer);
		window.cancelAnimationFrame(this.frame); this.frame = 0;
		this.target?.removeClass('is-drop-target'); this.target = undefined;
		this.ghost?.remove(); this.ghost = undefined;
	}
	private navigate(event: KeyboardEvent): void {
		if (!this.enabled() || event.defaultPrevented || event.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
		const target = event.target as HTMLElement | null;
		if (!target || target.isContentEditable || target.closest('input, textarea, select, .menu, .modal-container') ||
			Array.from(this.root.ownerDocument.querySelectorAll<HTMLElement>('.menu, .modal-container')).some(el => el.getClientRects().length)) return;
		const card = target.closest<HTMLElement>('.horizon-kanban-card'); const cell = card?.parentElement;
		if (!cell || !this.board?.contains(cell)) return;
		const cells = Array.from(cell.parentElement?.children ?? []);
		const offset = event.key === 'ArrowRight' ? 1 : -1;
		const next = cells[cells.indexOf(cell) + offset];
		const index = Array.from(cell.querySelectorAll('.horizon-kanban-card')).indexOf(card);
		const cards = next?.querySelectorAll<HTMLElement>('a.horizon-note-link');
		const link = cards?.[Math.min(index, cards.length - 1)];
		if (link) { event.preventDefault(); event.stopPropagation(); link.focus({ preventScroll: true }); link.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
	}
}
