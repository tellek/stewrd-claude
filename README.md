# Claude

A Stewrd plugin for editing Claude Code configuration: Rules (`CLAUDE.md`),
Settings (`settings.json`), Output Styles, Agents, Skills, and Commands, each
a top tab in the plugin pane. By default it edits the global
`%USERPROFILE%\.claude`.

- **Target Project** — pick a recent project or enter a folder path to scope
  every tab to `<project>\.claude` (Rules is `<project>\CLAUDE.md`). Each
  targeted project, plus Global, becomes a sidebar sub-item; "Remove Project"
  drops it, and Global's sub-item disappears when no projects remain. The
  sidebar icon shows the worst save status across all scopes (see "Sidebar
  Icon Color Rules" in `CLAUDE.md`: success lasts 3s of focused time, and
  disk conflicts show as warnings).
- **Rules / Settings** — full-height auto-saving editors.
  Settings refuses to save invalid JSON.
- **Output Styles / Agents / Skills / Commands** — a "Load" button next to
  the status dot opens a right-side drawer listing every entry (flat `*.md`
  files for Output Styles/Agents/Commands, `skills/<name>/SKILL.md` folders
  for Skills). Each row can be opened (click the name), renamed, toggled
  enabled/disabled, or deleted (with confirmation); a "Create New <Kind>" row
  at the bottom prompts for a name and opens the new blank file. The main
  area shows "Load a(n) <Kind> to continue." until an entry is picked. Entries
  are listed enabled-first, each group alphabetical. Each tab remembers which
  entry (if any) was last open and reopens it automatically next time.
- **Cursor/scroll memory** — every editor (Rules, Settings, and each opened
  file-list entry) remembers its cursor position and scroll offset per file
  and restores them the next time that file is opened.
  - **Enable/Disable:** Claude Code has no native disabled flag for these, so
    disabling an entry moves it into a sibling `<dir>-disabled` folder (e.g.
    `agents-disabled`) that Claude Code doesn't scan; enabling moves it back.
    The drawer lists both folders together, via a toggle per row (tooltip
    explains its state).
  - Rename/enable-disable/delete are disabled for the currently-open entry
    while it has unsaved edits, to avoid racing the autosave debounce.
- **Status dot** — next to the tab row (Load button sits to its right on the
  four drawer-based tabs): idle by default, in-progress while saving, green
  on success (reverting to idle after a fixed 5s, regardless of window/plugin
  focus), red with a tooltip on save errors or an on-disk conflict (click it
  to reload). Idle also covers just having loaded/opened a file — the dot
  only turns green after an actual save, never on load alone. Each tab's own
  status is mirrored independently onto its own sidebar sub-item as it's
  reported, not just whichever tab is currently open.
- **Save delay** — every editor auto-saves 3 seconds (configurable, see
  below) after the last keystroke, not on every change.

Every path this plugin edits under `~/.claude` (`CLAUDE.md`, `settings.json`,
`output-styles`, `agents`, `skills`, `commands`), as well as the save delay
(`saveDelayMs`, milliseconds, default `3000`), is overridable in this
plugin's own `settings.json` — see `lib/pluginPaths.ts`. Path defaults are all
relative to `~/.claude`, so they work unmodified on any machine.

## How it edits `~/.claude`

`api.fs` is sandboxed to this plugin's own folder, so reading/writing real
`~/.claude` files goes through `api.shell.exec` (PowerShell) instead —
`lib/claudeHome.ts` is the only place that happens. Notable choices, since
none of this is obvious from the code alone:

- **Encoding:** file content never touches PowerShell's stdout/argv as raw
  text — Windows PowerShell 5.1 redirects stdout through the console's OEM
  code page (not UTF-8), and `Get-Content` misreads BOM-less UTF-8 as ANSI.
  Reads/writes move content as base64 of the exact bytes instead, decoded in
  JS with `TextDecoder`.
- **Writes stage through this plugin's own sandbox first** (`api.fs.writeTextFile`
  on a uniquely-named file), then a short PowerShell command does a plain
  `Copy-Item` — file content never appears as a `-Command` argument, which
  would silently fail past Windows' ~32KB command-line limit.
- **Per-path write queue + mtime check:** `claudeHome` tracks each file's last
  known `LastWriteTimeUtc` and re-checks it immediately before every write,
  aborting (surfaced as "File Changed On Disk") if something else touched the
  file since. A per-path promise queue serializes writes/reads to the same
  file so a fast autosave debounce can never race a slower PowerShell spawn.
- **Create New** uses an exclusive filesystem create (`New-Item` without
  `-Force`), not a check-then-write, so two near-simultaneous creates of the
  same name can't both succeed.
- **Rename/enable-disable** (`renameEntry`) never `Move-Item -Force`s: it
  checks the destination first and returns `"exists"` rather than clobbering
  it, and (for a pure case-change rename, which Windows PowerShell 5.1
  otherwise rejects as "source and destination are the same") hops through a
  temporary sibling name. Deletes and renames deliberately leave the old
  path's cached mtime in place instead of clearing it, so a stale write that
  lands after the move is rejected as a conflict rather than silently
  recreating/resurrecting the file.

## Development

```sh
npm install
npm run build          # one-shot
npm run watch           # rebuild on save
```

`build-release.bat` deploys the built plugin into a local Stewrd install at
`C:\Utilities\stewrd\plugins\claude-control` — internal use only, not part of
what ships.
