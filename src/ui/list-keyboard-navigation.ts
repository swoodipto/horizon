import { Component, Platform } from 'obsidian';

interface RowIdentity {
	path: string;
	line: string | null;
}

interface PendingFocus {
	identity: RowIdentity;
	index: number;
	element: Element;
}

/** Navigate the rendered rows without activating their native links or buttons. */
export class ListKeyboardNavigation extends Component {
	private pendingFocus: PendingFocus | undefined;
	private selected = new Set<string>();
	private anchor: string | undefined;

	constructor(private root: HTMLElement, private rowSelector: string, private isActive: () => boolean) {
		super();
		this.registerDomEvent(root.ownerDocument, 'keydown', event => this.onKeydown(event));
		this.registerDomEvent(root.ownerDocument, 'click', event => {
			const target = event.target as HTMLElement | null;
			if ((!this.selected.size && !this.pendingFocus) || !target ||
				target.closest('.menu, .modal-container') || this.rowFor(target, this.rows())) return;
			const focused = root.ownerDocument.activeElement as HTMLElement | null;
			const focusedRow = focused ? this.rowFor(focused, this.rows()) : undefined;
			this.reset();
			if (focusedRow) focused?.blur();
		}, true);
		this.registerDomEvent(root, 'pointerdown', event => {
			if (!event.shiftKey || !this.isActive()) return;
			const rows = this.rows();
			if (rows.some(row => this.key(row) === this.anchor)) return;
			const focused = root.ownerDocument.activeElement;
			const row = focused ? this.rowFor(focused, rows) : undefined;
			if (row) this.anchor = this.key(row);
		}, true);
		this.registerDomEvent(root, 'click', event => {
			const target = event.target as HTMLElement | null;
			if (!target || !this.isActive() || this.isEditable(target)) return;
			const rows = this.rows();
			const row = this.rowFor(target, rows);
			if (!row) return;
			const multiple = Platform.isMacOS ? event.metaKey : event.ctrlKey;
			if (multiple && !event.altKey && !event.shiftKey) {
				event.preventDefault(); event.stopPropagation();
				const key = this.key(row);
				if (this.selected.has(key)) this.selected.delete(key);
				else this.selected.add(key);
				this.syncSelection();
				const destination = this.selected.has(key) ? row : rows.filter(item => this.selected.has(this.key(item))).at(-1);
				this.anchor = destination ? this.key(destination) : undefined;
				if (destination) this.focusRow(destination);
				else root.focus({ preventScroll: true });
			} else if (event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
				event.preventDefault(); event.stopPropagation();
				const focused = this.root.ownerDocument.activeElement;
				this.selectRange(rows, row, focused ? this.rowFor(focused, rows) : undefined);
				this.focusRow(row);
			} else if (!target.closest('button') || !this.selected.has(this.key(row))) {
				this.selectSingle(row);
			}
		}, true);
		this.registerDomEvent(root.ownerDocument, 'focusin', event => {
			// Removing a focused row sends focus to body without a focusin event.
			// Any deliberate focus change during the redraw takes precedence.
			if (this.pendingFocus && event.target !== this.pendingFocus.element) this.pendingFocus = undefined;
		});
		this.register(() => this.reset());
	}

	beforeRender(): void {
		this.pendingFocus = undefined;
		const focused = this.root.ownerDocument.activeElement;
		if (!focused || !this.root.contains(focused)) return;
		const rows = this.rows();
		const row = this.rowFor(focused, rows);
		const identity = row && this.identity(row);
		if (row && identity) this.pendingFocus = { identity, index: rows.indexOf(row), element: focused };
	}

	afterRender(): void {
		const pending = this.pendingFocus;
		this.pendingFocus = undefined;
		this.syncSelection();
		if (!pending || !this.isActive()) return;
		const doc = this.root.ownerDocument;
		const focused = doc.activeElement;
		if (focused && !this.root.contains(focused) && focused !== pending.element &&
			focused !== doc.body && focused !== doc.documentElement) return;
		const rows = this.rows();
		const row = rows.find(candidate => this.sameIdentity(this.identity(candidate), pending.identity))
			?? rows[Math.min(pending.index, rows.length - 1)];
		if (row) this.focusRow(row);
	}

	reset(): void {
		this.pendingFocus = undefined;
		this.selected.clear();
		this.anchor = undefined;
		this.syncSelection();
	}

	escape(): boolean {
		const focused = this.root.ownerDocument.activeElement;
		if (!this.isActive() || !focused || !this.root.contains(focused) ||
			(!this.rowFor(focused, this.rows()) && !this.selected.size)) return false;
		this.reset();
		this.root.focus({ preventScroll: true });
		return true;
	}

	private onKeydown(event: KeyboardEvent): void {
		const selectAll = (event.code === 'KeyA' || event.key.toLowerCase() === 'a') && !event.shiftKey &&
			(Platform.isMacOS ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
		const arrow = (event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.ctrlKey && !event.metaKey;
		if ((!selectAll && !arrow) || event.defaultPrevented || event.isComposing || event.altKey || !this.isActive()) return;
		const target = event.target as HTMLElement | null;
		const doc = this.root.ownerDocument;
		if (!target || (!this.root.contains(target) && target !== doc.body && target !== doc.documentElement) ||
			this.isEditable(target) || target.closest('button[aria-haspopup="menu"][aria-expanded="true"]')) return;
		if (Array.from(doc.querySelectorAll<HTMLElement>('.menu, .modal-container')).some(overlay => overlay.getClientRects().length > 0)) return;
		const rows = this.rows();
		if (!rows.length) return;
		const current = this.rowFor(target, rows);
		if (selectAll) {
			event.preventDefault(); event.stopPropagation();
			this.selected = new Set(rows.map(row => this.key(row)));
			const destination = current ?? rows[0];
			this.anchor = destination ? this.key(destination) : undefined;
			this.syncSelection();
			if (destination) this.focusRow(destination);
			return;
		}
		const index = current ? rows.indexOf(current) : -1;
		const next = index < 0 ? event.key === 'ArrowDown' ? 0 : rows.length - 1
			: Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
		const row = rows[next];
		if (!row) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.shiftKey) this.selectRange(rows, row, current);
		else this.selectSingle(row);
		this.focusRow(row);
	}

	/** Actions on a selected row apply to the visible selection; other rows stand alone. */
	actionRows(target: HTMLElement): HTMLElement[] {
		const rows = this.rows();
		const row = this.rowFor(target, rows);
		if (!row) return [];
		return this.selected.has(this.key(row)) ? rows.filter(item => this.selected.has(this.key(item))) : [row];
	}

	/** Select and reveal one exact note or inline entry after external navigation. */
	selectEntry(path: string, line?: number): boolean {
		const row = this.rows().find(candidate => candidate.getAttribute('data-note-path') === path &&
			candidate.getAttribute('data-note-line') === (line === undefined ? null : String(line)));
		if (!row) return false;
		this.selectSingle(row);
		this.focusRow(row);
		return true;
	}

	private key(row: Element): string {
		return JSON.stringify(this.identity(row));
	}

	private selectSingle(row: HTMLElement): void {
		this.selected = new Set([this.key(row)]);
		this.anchor = this.key(row);
		this.syncSelection();
	}

	private selectRange(rows: HTMLElement[], row: HTMLElement, current?: HTMLElement): void {
		let start = rows.findIndex(item => this.key(item) === this.anchor);
		if (start < 0) {
			start = rows.indexOf(current ?? row);
			this.anchor = this.key(rows[start] ?? row);
		}
		const end = rows.indexOf(row);
		this.selected = new Set(rows.slice(Math.min(start, end), Math.max(start, end) + 1).map(item => this.key(item)));
		this.syncSelection();
	}

	private syncSelection(): void {
		const visible = this.rows();
		const keys = new Set(visible.map(row => this.key(row)));
		this.selected = new Set([...this.selected].filter(key => keys.has(key)));
		if (this.anchor && !keys.has(this.anchor)) this.anchor = undefined;
		for (const row of Array.from(this.root.querySelectorAll<HTMLElement>(this.rowSelector))) {
			const selected = this.selected.has(this.key(row));
			row.classList.toggle('is-selected', selected);
			row.parentElement?.classList.toggle('has-selection', selected);
		}
	}

	private rows(): HTMLElement[] {
		return Array.from(this.root.querySelectorAll<HTMLElement>(this.rowSelector))
			.filter(row => this.isVisible(row));
	}

	private rowFor(target: Element, rows: HTMLElement[]): HTMLElement | undefined {
		const direct = target.closest<HTMLElement>(this.rowSelector);
		if (direct && rows.includes(direct)) return direct;
		// A project's status button is a sibling of its link and carries the same identity.
		const identified = target.closest<HTMLElement>('[data-note-path]');
		if (!identified || !this.root.contains(identified)) return undefined;
		const identity = this.identity(identified);
		return identity ? rows.find(row => this.sameIdentity(this.identity(row), identity)) : undefined;
	}

	private identity(row: Element): RowIdentity | undefined {
		const path = row.getAttribute('data-note-path');
		return path === null ? undefined : { path, line: row.getAttribute('data-note-line') };
	}

	private sameIdentity(left: RowIdentity | undefined, right: RowIdentity): boolean {
		return left?.path === right.path && left.line === right.line;
	}

	private isEditable(target: HTMLElement): boolean {
		return !!target.closest('input, textarea, select, [role="textbox"]') || target.isContentEditable;
	}

	private isVisible(row: HTMLElement): boolean {
		for (let element: HTMLElement | null = row; element; element = element.parentElement) {
			if (element.hidden || element.hasAttribute('inert')) return false;
			if (element.tagName === 'DETAILS' && !element.hasAttribute('open')) {
				const summary = Array.from(element.children).find(child => child.tagName === 'SUMMARY');
				if (!summary?.contains(row)) return false;
			}
		}
		return row.getClientRects().length > 0;
	}

	private focusRow(row: HTMLElement): void {
		row.focus({ preventScroll: true });
		row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}
}
