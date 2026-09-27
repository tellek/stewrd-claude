/// <reference path="../.stewrd/plugin-api.d.ts" />
// Reads this plugin's own settings.json for the configurable ~/.claude
// paths it edits. There's no host API for a plugin to read its own
// settings.json at runtime (api.fs is sandboxed to data/, one level below
// the plugin's own folder) - see CLAUDE.md's "Everything else in the file
// is yours to define and read back via your own ctx.api.shell.exec-based
// workaround" note. api.fs.getRootPath() resolves to <plugin dir>/data, so
// its parent is the plugin's own folder, next to settings.json.
import type { PluginApi } from "stewrd-plugin-api";

export interface PluginPaths {
  claudeMdPath: string;
  settingsJsonPath: string;
  outputStylesDir: string;
  agentsDir: string;
  skillsDir: string;
  commandsDir: string;
}

// Defaults are relative to ~/.claude, so they work unmodified on any
// machine - only override in settings.json for a non-standard layout.
export const DEFAULT_PLUGIN_PATHS: PluginPaths = {
  claudeMdPath: "CLAUDE.md",
  settingsJsonPath: "settings.json",
  outputStylesDir: "output-styles",
  agentsDir: "agents",
  skillsDir: "skills",
  commandsDir: "commands",
};

export async function loadPluginPaths(api: PluginApi): Promise<PluginPaths> {
  try {
    const dataRoot = await api.fs.getRootPath();
    const pluginDir = dataRoot.replace(/[\\/]data[\\/]?$/, "");
    const script = `
$ErrorActionPreference = 'Stop'
try {
  $path = Join-Path $env:PLUGIN_DIR "settings.json"
  if (-not (Test-Path -LiteralPath $path)) {
    Write-Output (@{ exists = $false } | ConvertTo-Json -Compress)
  } else {
    $text = [IO.File]::ReadAllText($path)
    Write-Output (@{ exists = $true; content = $text } | ConvertTo-Json -Compress)
  }
} catch {
  Write-Output (@{ exists = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
}`;
    const result = await api.shell.exec(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { env: { PLUGIN_DIR: pluginDir } },
    );
    if (result.code !== 0) return DEFAULT_PLUGIN_PATHS;
    const lines = result.stdout.trim().split(/\r?\n/);
    const parsed = JSON.parse(lines[lines.length - 1] ?? "{}") as { exists: boolean; content?: string };
    if (!parsed.exists || !parsed.content) return DEFAULT_PLUGIN_PATHS;
    const settings = JSON.parse(parsed.content) as Partial<PluginPaths>;
    return { ...DEFAULT_PLUGIN_PATHS, ...settings };
  } catch {
    return DEFAULT_PLUGIN_PATHS;
  }
}
