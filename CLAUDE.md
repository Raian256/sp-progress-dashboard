# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A dashboard plugin for [Super Productivity](https://super-productivity.com) built to help a user with executive-function differences (ADHD/autism) put in steady tracked hours across their projects. The host renders the plugin inside a sandboxed iframe, so **all UI logic lives in one self-contained file: `sp-dashboard/index.html`** (CSS in a `<style>` block, all JS in a single `<script>` block). There is no framework and no runtime dependency other than the host's `PluginAPI`.

Three tab views: **Today** (the centrepiece), **Retrospective** (bar chart, activity heatmap, group allocation, weekly review), and **Settings** (preferences + group/goal management). The **Today** view has two modes that swap automatically on tracking state — an idle **Launchpad** and a **Focus** engine (see Architecture). The README is the product-level explanation of the design goals; this file is the technical one.

**Host API reference:** Super Productivity's plugin API and hooks are documented at <https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md> (the authoritative TypeScript interfaces are in the repo's `packages/plugin-api/src/types.ts`). Consult these before using an unfamiliar `PluginAPI` method or `PluginAPI.Hooks.*` — the docs can lag the types.

## Commands

```bash
npm test                 # Run Vitest/JSDOM unit tests once
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report
npm run check:syntax     # Parse index.html's <script> with Acorn — fast syntax sanity check
npm run screenshots      # Render every Today-view state to screenshots/ (Puppeteer + faked clock)
npm run screenshot       # Regenerate README hero assets/*.png via Puppeteer

make build               # Clean, generate manifest.json from template, minify HTML, zip -> sp-dashboard.zip
make release             # release-check + build + git tag + push + gh release (needs gh, clean tree)
make clean               # Remove build/, zips, generated manifest.json
```

Run a single test with Vitest's filter, e.g. `npx vitest run -t "format time"`.

## Architecture & data flow

**Data pull → render.** `pullDataFromSP()` (near the bottom of the script) calls `PluginAPI.getTasks()`, `getArchivedTasks()`, and `getAllProjects()`, stores the results in module-level `cachedTasks`/`cachedProjects`, then calls `processData(tasksArr, projectsArr)`, which computes all metrics and re-renders the whole UI. Rendering is idempotent — the code always re-runs `processData` against the caches rather than mutating the DOM incrementally.

**Live updates come from the host, not polling alone.** `sp-dashboard/plugin.js` runs in the host app (not the iframe). It subscribes to the Redux `ACTION` hook and, on any action, `postMessage`s `{ type: 'SP_STATE_CHANGED' }` to the plugin iframe. `index.html` listens for that message and re-runs `pullDataFromSP()`. There is also a `setInterval(..., 60000)` fallback refresh inside `index.html`.

**The Today view is tracking-state-driven, then block-state-driven.** `renderTodayView(metrics)` (called from `updateDashboardUI`) first chooses via `resolveTrackingMode(current, groups, stats)`: if a task is tracked it renders the **Focus** engine (`#td-focus`, a live SVG ring driven by a 1s `updateFocusLive` ticker); otherwise it calls `renderIdle`, which branches on the `computeRunway` block-state into one of **three idle sub-views**, each its own `hidden`-toggled section:
- `active` (inside a block) → **Launchpad** (`#td-idle`) via `renderLaunchpad` (→ `renderRunway` / `renderLanes` / `renderMomentum`).
- `upcoming` (between/before blocks) → **On a Break** (`#td-break`) via `renderOnBreak` — next-block preview + prev-block closure (`previousBlock`) + totals; pure rest, no lane gap.
- `done` (past the last block) → **Day Complete** (`#td-done`) via `renderDayComplete` — today's total, per-lane final standing, streak, week bridge; strictly neutral, and it absorbs the wind-down banner (`renderWindDownBanner` suppresses itself when idle + `done`).

No blocks configured falls back to the Launchpad. Lane rows (`orderLanes`/`laneRowHtml`) and the momentum strip (`computeMomentum`) are factored out so Launchpad and Day Complete share them. The runway/day-timeline math is the pure, tested `computeRunway`.

**Tracking detection is observe-only — the plugin never starts/stops/changes tracking.** `plugin.js` also registers `PluginAPI.Hooks.CURRENT_TASK_CHANGE` and forwards `{ type: 'SP_TRACKING_CHANGED', current, previous }` to the iframe; the message handler sets module-level `trackingCurrent` / `focusSessionStart` and switches mode immediately. This hook is authoritative; a time-delta fallback (`updateTrackingFallback`, wired into `pullDataFromSP`) infers the tracked task on older SP builds or mid-session reloads.

**Standalone dev fallback.** When `window.PluginAPI` is absent (opening `index.html` directly, or in tests), the code falls back to built-in mock data so the dashboard renders without the host. The standalone bootstrap reads `?scenario=NAME` (`idle` | `met` | `empty` | `focus` | `focus-met` | `focus-ungrouped`) to preview each Today state; `scripts/screenshots.mjs` drives these with a faked wall-clock to produce `screenshots/*.png`.

**Settings & groups persist in `localStorage`, not the host.** All user config uses keys prefixed `sp-dashboard-*` (`-week-start-day`, `-chart-unit`, `-chart-count-<unit>`, `-chart-display`, `-active-view`, `-wind-down-hour`, `-groups`, legacy `-goal-period`/`-goal-today`). Groups are a JSON array in `sp-dashboard-groups`, each `{ id, name, weeklyGoalH, dailyGoalH, projectIds, color }`, managed via the Settings / "Manage Groups" view (`loadGroups`/`saveGroups`/`renderGroupsSettings`). Note: `manifest.json.template` declares `persistDataSynced`/`loadSyncedData` permissions, but the code does not currently use those APIs.

## Testing conventions (important)

Tests in `tests/index.test.js` read the real `sp-dashboard/index.html`, find the `<script>` whose text `.includes('processData')`, and execute it via `new Function(...)` bound to `window`. They then assert against functions the script explicitly attaches to `window` at the bottom of the script (e.g. `window.formatTime`, `window.processData`, `window.loadGroups`, `window.computeGroupStats`, `window.updateBarChart`, `window.renderHeatmap`, `window.resolveTrackingMode`, `window.computeRunway`, `window.renderTodayView`).

**A new function is only testable if you add `window.<name> = <name>;` to that export block.** If tests can't see a helper, that export line is the reason.

## Build details

`make build` copies `sp-dashboard/` into `build/`, renders `manifest.json` from `manifest.json.template` (substituting `{{VERSION}}`/`{{DESCRIPTION}}` from `package.json`), then minifies via `scripts/minify.sh` (html-minifier-terser with inline CSS/JS minification) and zips the result. `build/`, `*.zip`, and the generated `sp-dashboard/manifest.json` are gitignored — edit the `.template`, never a generated `manifest.json`.

## Conventions

- Keep everything in `index.html` self-contained — no external scripts, styles, fonts, or network calls; the plugin runs in a sandboxed iframe.
- Theme via CSS custom properties; support light and dark (`body.dark-theme`).
- Times are milliseconds internally; `3600000` = 1 hour recurs throughout. Use the existing `formatTime`/`formatDateShort`/`toLocalDateStr` helpers rather than reimplementing.
- Wrap `PluginAPI` calls in try/catch and degrade to mock/cached data on failure.
- **Design intent is executive-function support (AuDHD).** Keep the Today view calm and low-noise: one focal point per mode, a stable layout that doesn't rearrange, near-zero red (reserve the amber cue for a genuine time squeeze), and honour `prefers-reduced-motion`. Don't add prescriptive nudges ("do X now") — the view makes standing legible and protects the current session; it doesn't tell the user what to work on. Today-view design tokens are scoped under `#view-today` so Retrospective/Settings keep their existing look.
- The dashboard **observes** tracking (`CURRENT_TASK_CHANGE`) but must never start, stop, or change it.
