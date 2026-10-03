/// <reference path="../.stewrd/plugin-api.d.ts" />
// Project discovery/validation. Claude Code stores sessions under
// ~/.claude/projects/<encoded-path>, but the encoding is lossy (":", "\" and
// "/" all become "-"), so the real path is read from the "cwd" field of a
// session .jsonl instead of decoding the folder name.
import type { PluginApi } from "stewrd-plugin-api";

async function runPS(api: PluginApi, script: string, env: Record<string, string> = {}) {
  const result = await api.shell.exec(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { env },
  );
  if (result.code !== 0) throw new Error(result.stderr || "PowerShell Failed");
  const lines = result.stdout.trim().split(/\r?\n/);
  return JSON.parse(lines[lines.length - 1] ?? "{}");
}

// String.raw keeps the PowerShell regex/backslashes exactly as written.
const DISCOVER_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$root = Join-Path $env:USERPROFILE ".claude\projects"
$out = @()
if (Test-Path -LiteralPath $root) {
  foreach ($d in Get-ChildItem -LiteralPath $root -Directory) {
    $f = Get-ChildItem -LiteralPath $d.FullName -Filter *.jsonl -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($f) {
      foreach ($line in (Get-Content -LiteralPath $f.FullName -TotalCount 50)) {
        if ($line -match '"cwd":"((?:[^"\\]|\\.)*)"') {
          $c = $Matches[1] -replace '\\\\', '\'
          if (Test-Path -LiteralPath $c -PathType Container) { $out += $c }
          break
        }
      }
    }
  }
}
Write-Output (@{ paths = @($out | Select-Object -Unique) } | ConvertTo-Json -Compress)`;

export async function discoverProjects(api: PluginApi): Promise<string[]> {
  try {
    const parsed = await runPS(api, DISCOVER_SCRIPT);
    return (parsed.paths as string[]) ?? [];
  } catch {
    return [];
  }
}

export async function directoryExists(api: PluginApi, path: string): Promise<boolean> {
  try {
    const parsed = await runPS(
      api,
      "Write-Output (@{ ok = (Test-Path -LiteralPath $env:P -PathType Container) } | ConvertTo-Json -Compress)",
      { P: path },
    );
    return parsed.ok === true;
  } catch {
    return false;
  }
}
