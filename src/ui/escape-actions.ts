import { Component } from 'obsidian';

type EscapeAction = (event: KeyboardEvent) => boolean;

/** Dispatch Escape to the most recently registered action that can handle it. */
export class EscapeActions extends Component {
	private actions: EscapeAction[] = [];

	constructor(doc: Document) {
		super();
		this.registerDomEvent(doc, 'keydown', event => {
			if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
			for (const action of [...this.actions].reverse()) {
				if (!action(event)) continue;
				event.preventDefault();
				event.stopPropagation();
				return;
			}
		}, true);
		this.register(() => { this.actions = []; });
	}

	addAction(action: EscapeAction): () => void {
		this.actions.push(action);
		return () => { this.actions = this.actions.filter(candidate => candidate !== action); };
	}
}
