# horizon

A planning sidebar for Obsidian.

The sunrise tab appears in the top-left sidebar beside Files, Search, and Bookmarks. Select it to open horizon, or run **horizon: Open sidebar** from the command palette.

- **Horizon:** Areas, Goals, Projects, Insights.

Category clicks display entries in a center results tab. Areas matches `#area`, Goals matches `#goal`, and Projects matches `#project`. A tag in note properties lists the note name with its `parent` property (if present) on a muted second line, with an icon based on the parent note’s property tags: `layers-2` for areas, `goal` for goals, the current status icon for projects, `sticky-note` for other pages; a tag on a body line lists its text with the parent note name on a muted second line. Clicking a line entry opens its parent note at that line in the same tab, in either reading or editing mode. Bullet markers, task checkboxes, and matching tags are omitted from line labels. Nested tags are supported. Lists refresh when metadata or note names change. The calendar and timeline remain available through their commands.

In Goals, the center-list icon fills as a progress ring. Each sub-goal linked through `parent` and each direct project contributes equally; a sub-goal contributes the average of its own children. For whole-note projects, set a numeric `progress` property from 0 to 100 manually; a missing or invalid value contributes 0%, regardless of a non-completed status. Marking a whole-note project **completed** automatically writes `progress: 100`. Inline projects have no independent property and temporarily retain their previous status-based 0/25/50/100 contribution pending a separate decision. A project belongs to its first `parent` that is a goal in the list, and an inline project belongs to its source goal note. Dependency links do not count toward progress. Goals with no tracked children show 0%. Progress updates as project percentages, statuses and relationships change. Horizon also saves the rounded percentage as a numeric `progress` property on whole-note goals, including when the Goals list is closed. Horizon recalculates that property after relevant note changes, including manual edits to a goal's `progress`. Inline goals keep their calculated icon but do not write `progress` to their shared source note.

The sidebar Goals disclosure lists goals with 1–99% rounded progress, showing only the first level of partial sub-goals beneath each goal. Deeper active descendants appear as an indented **N more active subgoals** button below their first-level parent; selecting it opens the full Goals list, highlights that parent goal, and scrolls it into view. When a parent (such as an Area) is outside the partial list, its name and icon appear as a muted heading above the goal. The Projects disclosure lists Discuss, Ready and Doing projects grouped by parent. Each entry opens its note (or tagged line); selecting the category label opens the full list, while the arrow only expands or collapses the sidebar entries.

While navigating Horizon, press **A** for Areas, **G** for Goals, **P** for Projects, **I** for Insights, **U** for Upcoming or **T** for Timeline. These single-letter shortcuts work in the Horizon sidebar and results view, and leave note editing, text inputs, menus and dialogs untouched.

In **Settings → horizon**, **Use theme content width** follows the theme’s reading-mode width by default. Turn it off to set **Custom content width** in pixels. Width changes apply immediately and are saved.

In the Areas, Goals or Projects list, press **Down** or **Up** to focus the next or previous entry, including nested entries. The highlight matches the row's hover style. Press **Enter** to open the focused entry or **Escape** to leave row navigation. Focused entries scroll into view and stay focused when the list refreshes.

In Projects, select a circle to open Obsidian’s native menu: **todo**, **backburner**, **waiting**, **discuss**, **ready**, **doing**, **someday**, **completed**. Choosing a status updates the list icon and replaces the previous status tag in a whole note’s `tags` property or on the specific inline project line. Other tags are preserved. Todo is the default, shown as `circle-small` without a status tag; choosing todo clears status tags. Someday uses `circle-dashed`, backburner `circle-stop`, waiting `clock`, discuss `at-sign`, ready `circle`, doing `circle-chevron-right`, and completed `circle-check-big`. Selecting the rest of the row still opens the note in the same tab.

Projects and Goals show a muted start-date badge before the title (for example, **2. Nov**) when the note has a valid `start date` property. They show their note’s `deadline` property beside a `flag-triangle-right` icon, shown as days remaining (for example, **7d left**, **today** or **2d overdue**; today and overdue deadlines appear in red). Select the flag or date, or focus an entry with **Up/Down** and press **Shift+D**, to set, change or clear the deadline. Dates are saved as `YYYY-MM-DD` in frontmatter; other properties are preserved. Tagged-line entries share their source note’s deadline.

In the Projects screen, focus an entry with **Up/Down**, then press **Shift+A** to open its status menu. Press **T** for todo, **B** for backburner, **W** for waiting, **D** for discuss, **R** for ready, **O** for doing, **S** for someday or **C** for completed. Shortcut hints appear in faint text before each status icon. **Escape** closes the menu without changing status. Doing uses its second letter because Discuss already uses D.

Projects show status pills above the list when at least two statuses are assigned to its entries. Pills stay available while filtering, and overflow scrolls horizontally on desktop and mobile. Selected pills use the theme accent color.

The **Projects** item in the sidebar expands to show projects with the Doing status. Select a nested project to open its note directly; select **Projects** to open the complete project list.

- Select a pill to show one status. Select the sole active pill again to show all projects.
- On macOS, hold **Command** while selecting pills to toggle multiple statuses. On Windows and Linux, hold **Ctrl**.
- On mobile, hold a pill for **1 second** to activate multi-select. A notice confirms the mode; subsequent taps toggle statuses. Hold a pill for 1 second again to return to single selection. Swiping cancels the hold so the pill row can scroll.
- Press **Escape** while focused in the Projects view to clear the selected statuses and exit multi-select. If an entry is focused, the first press leaves row navigation; press **Escape** again to clear the filters.

Filters are saved with the view and never change note contents. If a selected status disappears from the complete project list, it is removed from the filter; clearing the last selection shows all projects.

When a parent note appears in the same category list, its child notes and tagged lines nest underneath it with the supplied curved parent-child icon in a muted color. Multiple levels are supported. Each entry appears once, under the first available parent in its property order. The parent represented by indentation is omitted from the child’s subtitle; other parent references remain. Links to parents outside the list remain subtitles without indentation.

Icons use Obsidian’s `setIcon()` API. The Projects sidebar uses the previous four-circle Lucide grid, registered with `addIcon()`; project entry and parent-reference icons follow their status.

The `dependent` property supports the same note-link forms as `parent`. A note with `dependent: "[[Another note]]"` nests beneath Another note when both appear in the category, using the supplied arrow connector. References outside the current list remain in the subtitle. If both properties have available links, `parent` takes precedence, followed by `dependent`; each entry is listed once. Tagged lines stay beneath their source note with the parent connector. Both connectors are registered once and reused with native icon sizing, spacing, and muted colors.

## Goal insights

Select **Insights** or press **I** from Horizon to see Linear-style progress cards for every goal with calculated progress greater than zero, including completed goals. Small positive values below 1% display **<1%**. Select a goal title to open its note or tagged line in the same results tab.

The percentage uses the equal-child calculation above. Chart counters still count whole direct children: **Scope** counts all child goals and projects, **Started** counts partially progressed children, and **Completed** counts finished children. The yellow curve includes Started + Completed. Descendants are not flattened, and dependency links do not add scope. One whole-note project at `progress: 50` gives 50% goal progress but Scope 1, Started 1 and Completed 0, regardless of its non-completed status. A percentage-rate graph has not been implemented yet.

**Plan-based estimate** intentionally differs from Linear's historical velocity. Add the goal's own `start date` and `deadline` in `YYYY-MM-DD` format. Planned weekly velocity is seven times Scope divided by the inclusive start-to-deadline duration. Unstarted children count as one remaining item; Started children count as one-quarter. Estimates begin today, or at a future planned start, and can extend beyond an overdue deadline. The dotted earlier/later scenarios use ±40% duration, not measured statistical confidence. Missing, invalid or reversed dates keep the actual graph but disable its estimate; completed goals have no future estimate. Forecasts never write dates or reschedule notes. Inline goals use their source note's dates.

History begins when Horizon first observes a goal. It records changed values and hourly checkpoints while Obsidian is running, with seven-day chart samples and observed-completion bars. It does not reconstruct old progress from note dates or modification times. Closed, hidden or sleeping app intervals break the actual curve; completions during those intervals are not inferred. Scope additions, removals and reparenting do not create completion events. Reopening lowers the current completed count; each identifiable child contributes at most one observed completion per seven-day bucket. Whole-note and folder renames preserve identity; edited or ambiguous inline entries start a new baseline. This includes an inline status edit that changes its exact source line.

Hover over a graph, tap an observation, or focus it and use **Left/Right**, **Home/End** and **Escape** to inspect or clear values. Touch scrolling cancels selection. **View values** provides a readable table and forecast explanation. Cards adapt to theme/custom content width. History and preferences are saved together locally and survive plugin reloads; simultaneous multi-device history merging is not supported. There are no new runtime libraries, network requests or external services.

## Project planning

Run **horizon: Open calendar** for the calendar or **horizon: Open timeline** for the Gantt view. U and T also open those views from Horizon.

The calendar has **Day**, **4 days**, **Week**, **Month**, and **Year** views. All entries are all-day projects. The timeline has **Month**, **Quarter**, **Year**, and **5 years** scales, with zoom controls, pointer-centered zoom, and horizontal scrolling. The selected view, date, scale, and zoom are saved in Obsidian’s workspace layout.

Planning uses project notes with `project` in their `tags` property, including nested tags. The planning views also recognize `projects` as an alias. Dates are local calendar dates in `YYYY-MM-DD` format:

```yaml
---
tags:
  - project
start date: 2026-10-05
deadline: 2026-10-12
dependent:
  - "[[Research]]"
---
```

The project above depends on Research finishing. A project with both dates occupies the inclusive range from start to deadline. A project with only a start date or only a deadline appears on that date. A project without either date stays in **Needs planning**.

Select a project to edit its dates and dependencies, or choose **New project**. Drag a scheduled project to move its dates, or drag an undated project onto a calendar date. Drag the range edges to change the start or deadline. Drag across empty calendar dates to create a project with that range; drag across an undated timeline row to plan that project. The date editor provides the same changes without dragging. Moving a project preserves its duration and keeps a missing date property absent.

Planning an inline `#project` entry creates a project note beside its source note, using the same title and its line’s status. The new note gets a `parent` link to the source note. The source line keeps its text and unrelated tags; its project tags become a link to the new note, so it is not listed twice. Existing notes are never overwritten; filename collisions use a suffix while the original display title stays in the new note’s `title` property. If the source line changed, the conversion stops and asks you to reopen it.

Dependencies appear as arrows on the timeline. **Planning warnings** show overlapping dependency schedules, missing or undated prerequisites, invalid dates, and dependency cycles. A dependent project starts after its prerequisite’s deadline (or its start date when it has no deadline). A prerequisite marked completed does not block scheduling. Warnings never move other projects or change their statuses. The existing dependent nesting in category lists remains available.

Project dates and dependencies are saved directly in note properties, preserving unrelated properties and content. Invalid ranges are rejected, and stale editors stop instead of overwriting newer date/dependency changes. All planning operates locally; there are no calendar/Gantt libraries, external services, or network requests.

## Development

Requires Node.js and npm, and Obsidian 1.7.2 or later.

```sh
npm ci
npm run dev
```

Define options once in `src/ui/sidebar-options.ts`. The reusable registry in `src/ui/option-shortcuts.ts` keeps existing assigned keys and automatically gives new options their first available label letter. If the first letter is taken, it tries the second, then subsequent letters. UI controls and keyboard handlers reference that registry.

The development build watches `src/` and writes `main.js` in the plugin folder. Reload the plugin in Obsidian to load source changes.

```sh
npm run build
npm run lint
npm run test
```

Keep `main.js`, `manifest.json`, and `styles.css` together in `.obsidian/plugins/horizon/` when installing the plugin. Restart Obsidian after editing the manifest.

With a row focused in Areas, Goals or Projects, press **Option+P** (macOS) / **Alt+P** (Windows) to select a parent note, or **Option+D** / **Alt+D** to select a dependent note. Select an existing note with the native search picker; existing relation links are preserved. In Goals and Projects, **Shift+S** opens the start-date editor, **Shift+D** opens the deadline editor, and **Shift+A** opens project status. Dates and relations on tagged lines belong to their source note. These shortcuts pause while editing notes or using menus and dialogs. Reusable definitions live in `src/ui/note-action-shortcuts.ts`.

The Projects list shows undated entries first without a heading, dated entries under Upcoming, and all Someday entries last. Upcoming sorts ascending by `start date`, falling back to `deadline`, and stays flat to preserve date order. Someday takes precedence even when an entry has dates. Empty sections are hidden; active status filters hide headings while keeping date order. Undated and Someday sections retain nesting, and other parent/dependent references appear as subtitles. Goals and Areas retain their existing lists.

While navigating the Projects list, use **Left/Right** to cycle through visible status filters and All. Hold **Shift** with an arrow to progressively add adjacent filters in that direction, stopping at the ends. Release Shift to resume selecting one filter at a time; plain arrows cycle beyond either end back to All. The selected pill scrolls into view, and note editing or open dialogs/menus remain untouched.

In the grouped Projects list, select **Hide later items** below the list to hide Someday entries, or **Show later items** to restore them. Use **Shift+H** to toggle later items while navigating Projects. This preference is saved with the view. Status filters show their matching items regardless of that preference.

Active projects in the sidebar are grouped under muted headings from their `parent` property. Projects without parents appear first; projects with multiple parents use the first parent.

Select multiple list entries with **Shift+Up/Down** or **Shift+click**. **Command+click** on macOS or **Ctrl+click** on Windows/Linux toggles individual entries for a noncontiguous selection. **Command+A** on macOS or **Ctrl+A** on Windows/Linux selects all visible entries. Horizon UI text is not selectable, while editable fields retain text selection. Plain Up/Down resumes single-item selection, and Escape or a click outside the list clears selection. Status (**Shift+A**), start date (**Shift+S**), deadline (**Shift+D**), parent (**Alt+P**) and dependent (**Alt+D**) actions apply to all selected items. Clicking a status/date control on a selected row also edits the selection. Dates and relationships affect each source note once; statuses affect each selected note or inline entry independently. Selection survives metadata refreshes and drops entries no longer visible. Bulk writes report partial failures without discarding successful updates.

While navigating Horizon lists, **Command+Z** on macOS or **Ctrl+Z** on Windows/Linux undoes the last Horizon status, date or relationship change. Add **Shift** to redo. Each bulk action is one history step; new changes clear redo. History retains up to 50 actions in memory for the open list view and resets when that view closes or the plugin reloads. Note editing and modal text inputs keep their native undo behavior. Replay preserves unrelated properties and lines, rejects changed/missing targets, and reports partial progress if a bulk replay encounters a conflict. Calendar/timeline edits use their separate planning controls and are outside this list history.
