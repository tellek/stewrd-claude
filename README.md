# Claude Control

A Stewrd plugin for editing global Claude Code configuration under
`%USERPROFILE%\.claude`: Global Rules (`CLAUDE.md`), Global Settings
(`settings.json`), Output Styles, Agents, Skills, and Commands. Each is a
sidebar sub-item and a top tab in the plugin pane.

- **Global Rules / Global Settings** — full-height auto-saving editors.
  Settings refuses to save invalid JSON.
- **Output Styles / Agents / Commands** — a rollout list of the flat `*.md`
  files in that folder, plus "Create New".
- **Skills** — same rollout, but each entry is a `skills/<name>/SKILL.md`
  folder.

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

## Development

```sh
npm install
npm run build          # one-shot
npm run watch           # rebuild on save
```

`build-release.bat` deploys the built plugin into a local Stewrd install at
`C:\Utilities\stewrd\plugins\claude-control` — internal use only, not part of
what ships.
