# Horizon project instructions

Horizon is an Obsidian community plugin for browsing and organizing Areas, Goals, and Projects. It is built with TypeScript, bundled with esbuild, and is intended to work on desktop and mobile.

## Start here

- Read this file before changing the project. Check `git status` first and preserve all existing user changes and untracked files.
- For work that depends on past decisions, read `MEMORY.md` and the relevant notes in `handoffs/` when they exist. These are ignored local continuity files and may not exist in another clone. The newest handoff describes the latest saved state; old validation results are historical and must not be presented as freshly verified.
- Inspect current source before relying on this document or README for a detail that may have changed. Update README when user-facing behavior changes. Keep this file focused on durable constraints and architecture.
- Make the smallest change that satisfies the request. Do not broaden scope, rewrite adjacent UI, mutate personal vault notes, or commit, push, publish, tag, or deploy without the user's instruction.

## Current product state

- Plugin ID: `horizon`; current manifest version: `1.0.0`; minimum Obsidian version: `1.7.2`; `isDesktopOnly` is `false`. Treat the plugin ID and released command/view IDs as stable interfaces.
- The sidebar currently exposes **Areas**, **Goals**, **Projects**, and **Insights**. Projects can expand to show active Doing entries, grouped by the first `parent` reference. Insights shows percentage-pace cards for goals with a valid start date and canonical progress > 0, including 100%, and whole-note projects with a valid start date, including 0% progress, regardless of parent or goal links. Cards use their own deadline when set. Upcoming and Timeline remain deliberately hidden because those planning features are not ready for general use.
- Calendar and timeline planning views remain accessible through `horizon: Open calendar` / `horizon: Open timeline` and the existing U/T shortcuts. They are unfinished work in progress. Do not present them as accepted or complete, or reveal the hidden sidebar options, unless the user asks to resume and approve that work.
- List selection, bulk status/date/relation actions, outside-click deselection, and per-view in-memory undo/redo are implemented. History is limited to list status, date, and relation changes; it clears when the list closes or Horizon reloads. Calendar/timeline edits are outside that history.
- The local project memory describes an older source snapshot in places. Current source and later handoffs supersede it. Recent handoffs record implementation pushed as `0061a76`; verify the current branch and remote whenever delivery state matters.

The current Settings defaults are theme content width enabled and custom width `760px`. Valid custom widths are finite values from 200 through 4000 pixels. Normalize saved settings and apply width changes to open results views immediately.

## Architecture

Keep `src/main.ts` focused on plugin lifecycle, settings, view registration, command registration, and coordination. Put feature logic in focused modules; avoid growing a single large file. Follow the existing folder boundaries:

| Area | Ownership |
| --- | --- |
| `src/main.ts`, `src/settings.ts` | Plugin lifecycle, settings normalization, view and command setup |
| `src/ui/sidebar-manager.ts`, `sidebar.ts`, `sidebar-options.ts` | One sidebar leaf, visible options, active Doing-project list and sidebar navigation |
| `src/ui/notes-view.ts`, `tagged-notes.ts`, `open-note.ts`, `open-notes.ts` | Center lists, cached tag entries, rendering/state, and same-tab navigation |
| `src/ui/parent-notes.ts`, `entry-tree.ts`, `parent-entry-groups.ts`, `note-relations.ts`, `relation-picker.ts` | Relation parsing, list nesting/grouping, and guarded relation edits |
| `src/ui/project-status.ts`, `project-filter.ts`, `project-menus.ts`, `status-filter-pills.ts` | Status registry/writes, filtering, native status menus and pill interactions |
| `src/ui/list-keyboard-navigation.ts`, `row-action-keyboard.ts`, `note-action-shortcuts.ts`, `history-keyboard.ts`, `note-action-history.ts`, `bulk-note-actions.ts` | List selection, keyboard actions, bulk execution, and guarded list history |
| `src/ui/deadline.ts`, `deadline-control.ts`, `date-entry-groups.ts`, `note-date-editor.ts`, `later-items-*` | List date presentation, date grouping/editor, and Someday visibility |
| `src/planning/` | Shared planning types, date/dependency model, storage, editor, workspace state, and view registration |
| `src/insights/`, `src/plugin-data.ts` | Shared goal/project snapshots, current-value percentage pace, SVG cards/view, and compatible legacy item-history/settings persistence |
| `src/calendar/`, `src/timeline/` | Calendar and Gantt rendering, layout, scales and interactions; unfinished planning surfaces |
| `src/ui/icons.ts`, `icon-ids.ts`, `styles.css` | Reusable custom SVG registration and theme-aware presentation |

Use existing helpers and registries rather than duplicating rules. In particular, keep category/status shortcuts in their registries, share status definitions across menus/filtering/sidebar, and preserve the single-sidebar-leaf lifecycle handled by `SidebarManager`.

Use strict TypeScript and async/await with explicit error handling. Keep modules focused; when a file grows beyond roughly 200–300 lines, consider splitting it by responsibility. User-facing commands belong in plugin command registration and must keep stable IDs after release. Persist plugin preferences through awaited `loadData()`/`saveData()` and workspace view state through Obsidian's view-state APIs; do not mix the two stores.

## Data and behavior contracts

### Categories and entries

- Areas use `#area`, Goals use `#goal`, and the browser's Projects category uses `#project`. Category matching is case-insensitive and supports nested category tags; do not replace cached Obsidian tag positions with blind text scans.
- A category tag in frontmatter creates a whole-note entry. A category tag on a body line creates an entry for that exact line. A note may have both kinds of entries. Inline entries retain a zero-based line and their original source line when a write needs a concurrency guard.
- Relations come from `parent` and `dependent` note links. If both can place an entry, `parent` takes precedence and then `dependent`; an entry appears at most once and cycles must never hide entries or recurse forever. `dependent: [[B]]` on A means A appears under B when both are in the current list. Keep outside-list links visible as subtitles.
- Whole-note navigation and inline-line navigation use the provided results leaf. Inline line numbers are zero-based. Do not unexpectedly open a second tab or force a note into editing/reading mode.

### Project statuses

`src/ui/project-status.ts` is the authoritative order and icon map:

1. `todo` — `circle-small`
2. `backburner` — `circle-stop`
3. `waiting` — `clock`
4. `discuss` — `at-sign`
5. `ready` — `circle`
6. `doing` — `circle-chevron-right`
7. `someday` — `circle-dashed`
8. `completed` — `circle-check-big`

No explicit status means todo. Todo is represented by the absence of a known status tag. A note with several explicit statuses uses the last recognized status in tag order. Nested status tags do not count as their parent status. A whole-note status comes from its `tags` property; an inline project's status comes only from tags on that line.

Property status writes must preserve unrelated properties and tags. Inline status writes must use atomic `vault.process`, preserve line endings and unrelated text, and verify the cached source line before mutation. A moved line may be relocated only when there is exactly one identical match; changed, missing, or ambiguous targets must fail safely and ask the user to reopen the action. Do not write to adjacent lines or infer an inline project's status from its source note.

### Dates and planning

- YAML date properties are literally `start date` and `deadline`. The planning model's internal `start` field maps to `start date`; do not reintroduce a YAML `start` field or silently migrate existing notes. Preserve unrelated properties.
- Dates are local civil dates stored as `YYYY-MM-DD`, not timestamps. Use `src/planning/dates.ts` helpers for validation and arithmetic to avoid timezone/DST errors. A project with both dates occupies the inclusive start-to-deadline range; one date alone is a one-day item; no dates means Needs planning.
- Planning recognizes project notes via `project` and the `projects` YAML alias, including nested/case variants. The normal Projects browser continues to use its established `#project` category contract.
- A `dependent` link on A means A depends on that prerequisite. A should start after the prerequisite's inclusive finish, using its deadline or its start if no deadline exists. Completed prerequisites do not block schedule checks. Missing/non-project/undated dependencies, cycles, invalid dates and conflicts produce warnings; warnings never reschedule another project or change status.
- Planning is all-day project scheduling. Do not add task/time-slot semantics, a planned-finish field, or a calendar/Gantt dependency without an explicit request.
- Converting an inline project creates a sibling note beside the source, keeps its display title/status, adds a parent link to the source note, and replaces the line's project tag with a link to the new note while preserving other text/tags. Require at least one date. Guard both the source line and generated file; never overwrite a collision or delete a generated note another writer has changed.
- Existing planning writes must reject stale edits. Preserve unavailable dependency targets while editing dates. Dragging/moving a one-date project must not silently create a missing endpoint.

### List order and keyboard controls

- Category shortcuts are A for Areas, G for Goals, P for Projects, and I for Insights. U/T remain assigned to hidden Upcoming/Timeline options. The reusable option registry owns assignment and fallback; preserve stable bindings when adding options.
- In category lists, Up/Down navigates visible entries, Enter opens the focused entry, and Escape leaves row navigation before other Escape actions run. In Projects, Shift+A opens status, Shift+S edits start date, Shift+D edits deadline, Alt/Option+P edits parent, Alt/Option+D edits dependent, and Shift+H toggles Someday visibility. Keep status menu letters aligned with the current status registry: T/B/W/D/R/O/S/C in its listed order.
- Left/Right cycles filter pills. Shift+Left/Right adds adjacent filters until a boundary; from a multi-selection, unmodified arrows move beyond the outermost selected pill and return to one filter. Do not intercept these keys while a note editor or input is active.
- Project list groups are ordered as undated non-Someday entries first without a heading, dated entries under **Upcoming** in ascending `start date` order (falling back to `deadline`), and Someday entries last even when they have dates. Keep Upcoming flat to preserve global date order. Active status filters hide group headings while keeping matching entry order. Areas and Goals retain their existing list structure.
- Projects and Goals show a start-date badge before the title and a relative deadline control when dates exist. Unset deadlines have no visible control, while Shift+D remains available. Dates on inline entries belong to their source note. Today and overdue deadlines use the established `#F54370` accent. Refresh relative dates when the local day changes.

## Interaction and visual design rules

- Prefer Obsidian's native `Menu`, `Setting`, `Notice`, icon APIs, accessibility conventions and CSS variables. Match the active theme instead of introducing a separate visual language. Use `currentColor` for custom icons and register/remove custom icon definitions through plugin lifecycle.
- Preserve separate icon contracts: the Goals sidebar option uses Obsidian's native `target`, Goal entries use a progress ring based on the `horizon-goal` artwork, Goal references retain `horizon-goal`, and the Projects sidebar uses `horizon-layout-grid-circles`. Reuse registered `horizon-logo`, `horizon-parent-child`, and `horizon-dependent` artwork where their existing roles apply; do not rename IDs or redraw supplied assets during unrelated UI work.
- Keep copy short, sentence case and action-oriented. Use the actual current labels and shortcut registries; do not hard-code a shortcut where the registry allocates it.
- Insights uses separate Goals/Projects sections with empty sections hidden; each card contains its title, existing completion pie and percentage, lines and `day.month` dates. Keep full anchor details in tooltips. Label both graph endpoints and an interior deadline at its marker; avoid duplicate or overlapping date labels. Insights has its own centered 1480px maximum content width, independent of note/theme width settings, with at most four columns and two columns on mobile. Keep normal note-list width contracts unchanged.
- Preserve sidebar navigation as a separate action from the Projects disclosure arrow. The arrow only expands/collapses the Doing list; selecting Projects opens the complete list. Keep parent-group headings and children in their current alignment and native hover treatment.
- Preserve the accepted sidebar project-group styling: groups are separated by `var(--size-4-3)`; headings use `var(--font-ui-small)`, medium weight, faint text, `var(--size-2-1)` block padding and a `1em` icon. Sibling project rows have no added gap.
- Project filter pills show only statuses present in the complete list and disappear when fewer than two distinct statuses are available. A normal click selects one filter; Command-click (macOS) or Control-click (Windows/Linux) toggles multiple filters. Mobile long press enters multi-select; movement/scroll cancels the hold. Escape clears filters/exits the mode according to the existing handler. Filtering never writes note contents.
- Native status menus show their registry shortcut hints before the icons. Keep the project status tooltip text exactly **Change project status**, with the current 207px maximum width. Item tooltips use the entry text alone; relationship names remain in their visible subtitle.
- Status-pill focus outlines are intentionally disabled by the accepted design. Preserve that choice unless the user asks to revisit it.
- Preserve keyboard scope: list handlers must not steal input from note editors, text fields, contenteditable regions, menus/dialogs, or inactive views. Preserve platform modifier behavior. Escape actions are registered and cleaned up in stack order.
- Preserve multi-selection semantics: Shift selects ranges, Command/Control toggles individual rows, Select All covers visible rows only, and clicks outside the list clear selection while allowing the clicked control's action. Keep selection identities tied to source path and exact inline-line identity across metadata redraws.
- Bulk date/relation changes operate once per source note; status changes remain per selected whole-note/inline entry. Report partial success honestly. Undo/redo replays only captured values and must check current expected values before writing; stop on conflicts rather than overwrite newer user edits.
- Project progress is completed tasks / total tasks × 100, using Obsidian's cached `listItems` and native checkbox completion rule (space is incomplete; any other mark is complete). Whole-note projects count all tasks in that note, including nested tasks; inline list-item projects count only recursive child tasks, excluding their own checkbox and siblings. Plain bullets, code blocks, links and embeds are not extra tasks. No tasks means 0; completed project status overrides to 100; reopening recalculates from tasks. Checking all tasks never writes a status. Save rounded derived whole-note project `progress` when it changes; ignore and replace old manual values, but use unrounded ratios for all calculations. A dual-tagged goal/project keeps goal ownership of `progress`.
- Goal progress is derived from direct sub-goals and projects. Save the rounded numeric percentage to the `progress` property of whole-note goals when it changes, including while the Goals view is closed. Inline goals and projects have no separate frontmatter and must not write a shared note-level `progress` property. Preserve unrelated properties and keep derived writes outside list undo/redo. Include task state and hierarchy in synchronization invalidation/own-write fingerprints; guard pending writes against stale metadata.
- Keep category-list note titles and lists inside the existing shared `.horizon-note-results` content-width wrapper. Preserve the whole-row `.inline-title.horizon-results-heading` relationship and native theme padding; do not add fixed top offsets or constrain the heading/list separately. Insights uses its independent section layout above. Verify current CSS before layout edits because theme selectors depend on this structure.
- For category lists, theme-width mode follows Obsidian's readable-line-width setting; custom-width mode uses the saved width and disables that readable-width constraint. Preserve both paths and the user's theme typography.
- Horizon UI text is nonselectable except for editable inputs/textareas/contenteditable fields. Do not disable text selection outside Horizon roots.
- Respect reduced motion. Animation must be interruptible, start from current geometry on reversal, and clean up on redraw/close/unload.
- Use registered component/DOM/event/timer cleanup helpers. Debounce metadata/vault refreshes, guard asynchronous renders by generation, serialize conflicting vault writes, and avoid heavy work at plugin startup.

## Privacy, compatibility, and dependencies

- Default to offline/local behavior. There are no runtime network services or telemetry. Do not add remote requests, third-party data transfer, cloud dependencies or analytics without a clear user-facing need, explicit opt-in where appropriate, and README/settings disclosure.
- Keep vault access inside Obsidian APIs and touch only the requested files/notes. Never inspect unrelated vault content or expose note titles/paths in logs unnecessarily.
- Keep `isDesktopOnly: false` meaningful: avoid Node/Electron APIs in runtime feature code, and preserve touch, narrow-screen, keyboard and reduced-motion behavior. The esbuild config externalizes Obsidian/Electron and CodeMirror/Lezer modules; do not add runtime imports that Obsidian cannot provide.
- Keep dependencies small and browser-compatible. Use `package-lock.json` as the reproducible dependency source.
- Treat current release identity carefully. The manifest still has template-era author/funding values, and package metadata says `0-BSD` while `LICENSE` contains MIT notices. Do not silently resolve these identity/license decisions as incidental cleanup. Check current release requirements and ask only if a material choice is required.
- Follow Obsidian's [Developer Policies](https://docs.obsidian.md/Developer+policies) and [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines). Keep plugin metadata complete, preserve the released ID, and raise `minAppVersion` only when the code actually requires a newer API. Confirm release-entry requirements against Obsidian's [plugin validation workflow](https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-plugin-entry.yml).
- Use a current Node LTS (Node 18 or newer) for development. Do not use Node or Electron APIs in runtime feature code while the plugin remains mobile-compatible.

## Build, checks, and release artifacts

Use npm and the checked-in esbuild/TypeScript setup. For a fresh checkout run `npm ci`. The project scripts are:

```sh
npm run dev       # watch source and write main.js with inline source maps
npm run build     # TypeScript no-emit check, then production esbuild bundle
npm run lint      # ESLint and Obsidian-specific rules
npm test          # Node regression suite
```

The production bundle is CommonJS targeting ES2021, minified, with no source map. `main.js` is generated and ignored; never hand-edit or commit it. Keep release files at the plugin root: `main.js`, `manifest.json`, and `styles.css` when present. Commit source, tests and intentional docs only. For manual installation, place those release files under `<Vault>/.obsidian/plugins/horizon/`, then reload Obsidian. A source build alone does not install or validate the plugin in a running vault.

For implementation changes, run relevant regression tests plus build/typecheck/lint in proportion to the change and report what was not run. Tests use Node/esbuild and mocked Obsidian contracts; they do not prove behavior in a live vault. Browser fixtures with mock APIs do not replace live Obsidian, native menu, theme, minimum-version, or physical mobile checks. Use disposable test notes for native mutation checks.

Version changes must keep `manifest.json` and `versions.json` aligned. The npm version lifecycle runs `version-bump.mjs` and stages those files, so inspect the result before committing. Release tags match the manifest SemVer exactly with no leading `v`. The tag workflow builds and creates a draft release with individual runtime artifacts; a draft is not a published release or community-catalog registration. Do not release, publish, commit, or push unless requested.

The last documented delivery is commit `0061a76` on `main`, pushed to `origin/main`; verify current state before relying on this. At that delivery the 207-test suite and build passed, lint had zero errors plus one existing `getSettingDefinitions` warning, and the remote SHA matched. These are historical results, not a current baseline guarantee.

## Key files

- `src/main.ts` — plugin lifecycle and command/view setup.
- `src/ui/sidebar-options.ts` — category identities, visible labels and shortcut seed values.
- `src/ui/project-status.ts` — canonical status order, icons and safe writes.
- `src/ui/notes-view.ts` — center list rendering, selection/action integration and workspace view state.
- `src/planning/dates.ts`, `store.ts`, `dependencies.ts` — planning date contract, safe persistence and warning model.
- `src/calendar/`, `src/timeline/` — unfinished planning surfaces; keep their visibility boundary above.
- `styles.css` — theme-aware layouts and responsive behavior.
- `tests/` — focused regression tests for pure helpers and mocked Obsidian contracts.
- `README.md` — user-facing usage and shortcuts.
- `MEMORY.md`, `handoffs/` — local historical continuity when available; not release artifacts.

## Completion notes

Use sentence case for labels and headings. Keep in-app text short and action-oriented; use bold for literal UI labels in docs and arrow notation for navigation such as **Settings → Community plugins**. When feasible, verify desktop and iOS/Android behavior, especially touch, narrow layouts, menus and keyboard focus.

When finishing a requested implementation, state the behavior changed, the relevant checks and outcomes, and material unverified areas. Do not claim live-vault, device, CI, remote, or release verification unless it was performed. Keep local `MEMORY.md`, `handoffs/`, `data.json`, `node_modules/`, generated bundles and unrelated untracked material out of scoped commits.
