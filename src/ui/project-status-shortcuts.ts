import { buildOptionShortcuts } from './option-shortcuts';
import { PROJECT_STATUSES } from './project-status';

export const PROJECT_STATUS_SHORTCUTS = buildOptionShortcuts(
	PROJECT_STATUSES.map(status => ({ id: status.tag, label: status.tag, icon: status.icon })),
).map(({ option, key }) => ({ status: option.id, key }));
